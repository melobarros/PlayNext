using System.Collections.Concurrent;
using Microsoft.Extensions.Caching.Memory;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The L1 read cache, keyed by version and query (research D8).
///
/// The unit is a complete response, so a hit costs no query at all and — more
/// importantly — can never combine rows from two versions. Version keying is
/// what makes eviction a correctness measure: when a new version is promoted,
/// every entry under the old id is unreachable by construction, and
/// <see cref="Evict"/> only reclaims the memory.
///
/// The TTL (ten minutes) is deliberately shorter than the catalog's own
/// freshness window: a version-keyed entry cannot go stale in the sense of
/// belonging to another version, but the row-level retention gate and the
/// refresh's own cadence should not be frozen for a whole day of traffic.
/// </summary>
public sealed class CatalogPoolCache(IMemoryCache cache) : ICatalogPoolCache
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    /// <summary>Every cache key written under a version, so eviction can find them.</summary>
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<string, byte>> _keys = new();

    /// <summary>
    /// One gate per key. It serializes concurrent misses for the same response —
    /// without it, a cold popular deck would send every waiting request to the
    /// same query at once.
    /// </summary>
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new(StringComparer.Ordinal);

    /// <inheritdoc />
    public async Task<CatalogSnapshot> GetOrLoadAsync(
        Guid versionId,
        string queryKey,
        Func<CancellationToken, Task<CatalogSnapshot>> load,
        CancellationToken cancellationToken)
    {
        var key = Key(versionId, queryKey);

        Register(versionId, key);

        if (cache.TryGetValue(key, out CatalogSnapshot? cached) && cached is not null)
        {
            return cached;
        }

        var gate = _gates.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);

        try
        {
            // Re-checked behind the gate: the caller that held it before us may
            // have just filled the entry.
            if (cache.TryGetValue(key, out cached) && cached is not null)
            {
                return cached;
            }

            var snapshot = await load(cancellationToken);

            cache.Set(key, snapshot, Ttl);

            return snapshot;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <inheritdoc />
    public void Evict(Guid versionId)
    {
        if (!_keys.TryRemove(versionId, out var keys))
        {
            return;
        }

        foreach (var key in keys.Keys)
        {
            cache.Remove(key);
            _gates.TryRemove(key, out _);
        }
    }

    private static string Key(Guid versionId, string queryKey) => $"catalog:pool:{versionId:N}:{queryKey}";

    private void Register(Guid versionId, string key)
    {
        _keys
            .GetOrAdd(versionId, _ => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal))
            .TryAdd(key, 0);
    }
}

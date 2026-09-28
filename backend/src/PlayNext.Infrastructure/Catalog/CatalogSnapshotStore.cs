using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PlayNext.Application.Interfaces;
using PlayNext.Infrastructure.Persistence;

// Two types share the name this store is about: the application's value, which
// is what a request path sees, and the row, which is what the database sees.
// Both are in scope here and they are not interchangeable — the row is stored
// bytes, the value is a catalog — so they are named apart rather than left to
// whichever using happens to win.
using CatalogSnapshot = PlayNext.Application.Contracts.CatalogSnapshot;
using StoredSnapshot = PlayNext.Infrastructure.Persistence.CatalogSnapshot;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// Where the last good catalog for a region lives between requests: the memory
/// cache in front, the durable row behind (research D10).
///
/// A region's pool is the same for every visitor in that region, so it is
/// fetched once and served for as long as it is good — which is what keeps a
/// visitor's request away from the provider entirely. The store is a singleton,
/// because the thing being cached is a region's catalog rather than a
/// visitor's request.
///
/// <b>Why two levels rather than one.</b> The API is hosted scale-to-zero, so
/// the memory level is emptied on every scale-up — and a scale-up usually
/// accompanies the outage that makes the durable level matter. A memory-only
/// cache would make the first visitor after each restart pay for a full
/// retrieval, and FR-012's "the last successful catalog keeps serving" would be
/// false for exactly the restart it was written for.
///
/// The durable level is a cache of the provider, never a second source of truth
/// (data-model.md): it holds what was last retrieved, and nothing reads it that
/// would not equally accept a fresh retrieval.
/// </summary>
public sealed class CatalogSnapshotStore : ICatalogSnapshotStore
{
    /// <summary>
    /// The cache key for a region. Public because the reset path in the test
    /// host evicts by the same name: a test that clears a key the store does
    /// not use would leave a snapshot behind and pass for the wrong reason.
    /// </summary>
    public static string CacheKey(string region) => $"catalog:{region}";

    private readonly IMemoryCache _cache;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<CatalogSnapshotStore> _logger;
    private readonly TimeProvider _time;
    private readonly TimeSpan _maxAge;

    public CatalogSnapshotStore(
        IMemoryCache cache,
        IServiceScopeFactory scopes,
        ILogger<CatalogSnapshotStore> logger,
        TimeProvider time,
        IOptions<TmdbOptions> options)
    {
        _cache = cache;
        _scopes = scopes;
        _logger = logger;
        _time = time;
        _maxAge = options.Value.MaxCacheAge;
    }

    /// <inheritdoc />
    public async Task<CatalogSnapshot?> LoadAsync(string region, CancellationToken cancellationToken)
    {
        // An over-age entry in memory is not returned and not promoted further:
        // falling through to the durable read is what finds the row and purges
        // it, so the wasted lookup happens once rather than on every request.
        if (_cache.TryGetValue(CacheKey(region), out CatalogSnapshot? cached)
            && cached is not null
            && IsWithinRetention(cached))
        {
            return cached;
        }

        var payload = await ReadPayloadAsync(region, cancellationToken);

        if (payload is null)
        {
            Evict(region);

            return null;
        }

        var snapshot = CatalogSnapshotJson.Deserialize(payload);

        if (snapshot is null)
        {
            // Region and outcome only. The payload is bulk third-party data and
            // is not ours to put in a log record (constitution, security
            // standard) — and the row is left alone rather than deleted, because
            // a process that cannot read it is not obviously the one that should
            // be destroying it.
            _logger.LogWarning(
                "The stored catalog snapshot for {Region} could not be read; treating the region as unreached.",
                region);

            return null;
        }

        if (!IsWithinRetention(snapshot))
        {
            // The ceiling, not the freshness window (TmdbOptions.MaxCacheAge).
            // The row is *deleted* rather than merely withheld, because the term
            // prohibits keeping the data, not only serving it — and the region
            // is left to answer "not ready", which starts the retrieval that
            // replaces it. Logged without the payload, as everything here is.
            _logger.LogInformation(
                "The stored catalog snapshot for {Region} is past the provider's retention ceiling and was purged.",
                region);

            await PurgeAsync(region, cancellationToken);

            return null;
        }

        // Promoted, so the next request for this region is answered from memory.
        _cache.Set(CacheKey(region), snapshot);

        return snapshot;
    }

    /// <summary>
    /// Whether a snapshot is still young enough to keep at all — the provider's
    /// ceiling, which is a different question from whether it is fresh enough to
    /// serve without refreshing.
    /// </summary>
    private bool IsWithinRetention(CatalogSnapshot snapshot) =>
        _time.GetUtcNow() - snapshot.FetchedAt <= _maxAge;

    /// <summary>Drops a region from both levels, whichever of them answered.</summary>
    private void Evict(string region) => _cache.Remove(CacheKey(region));

    /// <summary>
    /// Deletes the region's stored row and its memory entry.
    ///
    /// Reached only from the retention path, so it is never a way for a bad
    /// fetch to lose good data (FR-013): a snapshot that is merely unwritable,
    /// unreadable or stale keeps its row.
    /// </summary>
    private async Task PurgeAsync(string region, CancellationToken cancellationToken)
    {
        Evict(region);

        using var scope = _scopes.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        await db.CatalogSnapshots
            .Where(row => row.Region == region)
            .ExecuteDeleteAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task SaveAsync(CatalogSnapshot snapshot, CancellationToken cancellationToken)
    {
        // Durable first, memory second. The two must not disagree about what
        // the region's catalog is, and the only ordering that guarantees it is
        // this one: a store that fails here leaves the visitor being served what
        // they had — the previously good snapshot, which is still in memory —
        // rather than a snapshot that only this process believes in (FR-013).
        await WritePayloadAsync(snapshot, cancellationToken);

        // A plain set, with no expiry of its own: the snapshot's age is a
        // decision the policy makes from FetchedAt, not one the cache should
        // make silently by dropping the entry. An eviction here would turn a
        // stale-but-servable catalog into a "not ready", which is a worse
        // answer to give a visitor whose deck could have rendered (FR-012).
        _cache.Set(CacheKey(snapshot.Region), snapshot);

        await SweepAsync(snapshot.Region, cancellationToken);
    }

    /// <summary>
    /// Purges every region past the retention ceiling, on the way out of a
    /// successful save.
    ///
    /// The read path already purges the region it is asked about, which covers
    /// every region anyone looks at. This covers the ones nobody does — a market
    /// the app no longer receives visitors from still holds data the terms stop
    /// us keeping, and it stops holding it the next time *any* region refreshes.
    ///
    /// A hosted sweeper would be the tidier home for this, and it is
    /// deliberately not used: the API is hosted scale-to-zero, so a timer that
    /// runs while the app is warm is a timer that does not run during the idle
    /// periods that matter. Refresh traffic is the one clock this host
    /// reliably has.
    /// </summary>
    private async Task SweepAsync(string justSaved, CancellationToken cancellationToken)
    {
        var cutoff = _time.GetUtcNow() - _maxAge;

        using var scope = _scopes.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        await db.CatalogSnapshots
            .Where(row => row.Region != justSaved && row.FetchedAt <= cutoff)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private async Task<string?> ReadPayloadAsync(string region, CancellationToken cancellationToken)
    {
        using var scope = _scopes.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Read-only and detached: this is a cache read, and tracking the row
        // would leave the context holding an entity nobody is going to change.
        return await db.CatalogSnapshots
            .AsNoTracking()
            .Where(row => row.Region == region)
            .Select(row => row.PayloadJson)
            .SingleOrDefaultAsync(cancellationToken);
    }

    private async Task WritePayloadAsync(CatalogSnapshot snapshot, CancellationToken cancellationToken)
    {
        using var scope = _scopes.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var payload = CatalogSnapshotJson.Serialize(snapshot);

        // One row per region, replaced whole (data-model.md): a row is never
        // patched, so what is stored is always a complete batch that succeeded
        // rather than a mixture of one that did and one that did not.
        if (await db.CatalogSnapshots.SingleOrDefaultAsync(
                row => row.Region == snapshot.Region, cancellationToken) is { } stored)
        {
            stored.FetchedAt = snapshot.FetchedAt;
            stored.PayloadJson = payload;
        }
        else
        {
            db.CatalogSnapshots.Add(new StoredSnapshot
            {
                Region = snapshot.Region,
                FetchedAt = snapshot.FetchedAt,
                PayloadJson = payload,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}

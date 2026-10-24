using PlayNext.Application.Contracts;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The L1 read cache, keyed by catalog version (research D8).
///
/// Version keying is the whole point: when a new version is promoted the old
/// entries can never be served again, and an eviction is a correctness measure
/// rather than a courtesy. The cached unit is a complete response, so a hit
/// never re-queries a half-built version.
/// </summary>
public interface ICatalogPoolCache
{
    /// <summary>
    /// The cached snapshot for this version and query, or the result of
    /// <paramref name="load"/> stored for ten minutes.
    /// </summary>
    Task<CatalogSnapshot> GetOrLoadAsync(
        Guid versionId,
        string queryKey,
        Func<CancellationToken, Task<CatalogSnapshot>> load,
        CancellationToken cancellationToken);

    /// <summary>Drops every entry for a version. Called on promotion.</summary>
    void Evict(Guid versionId);
}

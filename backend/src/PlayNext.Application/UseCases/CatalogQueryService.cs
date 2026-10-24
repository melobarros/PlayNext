using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Application.UseCases;

/// <summary>
/// Serves a catalog read from the source <c>Catalog:Source</c> names
/// (FR-007).
///
/// Both paths answer the same shape and share the same guarantees: a missing or
/// expired catalog is <c>NotReady</c> plus a background refresh, a stale one is
/// served while a refresh starts, and the source switch is read per request so
/// a rollback is a restart rather than a deployment (SC-005).
/// </summary>
public sealed class CatalogQueryService(
    ICatalogSnapshotStore snapshots,
    ICatalogVersionStore versions,
    ICatalogPoolReader reader,
    ICatalogPoolCache cache,
    ICatalogRefresher refresher,
    ICatalogRetentionStore retention,
    TimeProvider time,
    CatalogQueryPolicy policy)
{
    public async Task<CatalogResult> GetAsync(
        string region,
        CatalogPoolQuery query,
        CancellationToken cancellationToken)
    {
        return policy.Source == CatalogSource.Normalized
            ? await GetNormalizedAsync(region, query, cancellationToken)
            : await GetSnapshotAsync(region, query, cancellationToken);
    }

    /// <summary>
    /// The 005 path, unchanged: serve the snapshot, start a refresh when it is
    /// missing or stale.
    ///
    /// The targeted parameters are deliberately ignored here (contracts/
    /// catalog-api.md): the snapshot is already a complete pool and the client's
    /// own filters are what narrows it. <c>ids</c> is the one exception —
    /// returning the whole snapshot for a watchlist batch would defeat the
    /// point of the request, so the snapshot is filtered by id.
    /// </summary>
    private async Task<CatalogResult> GetSnapshotAsync(
        string region,
        CatalogPoolQuery query,
        CancellationToken cancellationToken)
    {
        var snapshot = await snapshots.LoadAsync(region, cancellationToken);

        if (snapshot is null)
        {
            refresher.TryStart(region, CatalogRunMode.Snapshot);
            return CatalogResult.NotReady();
        }

        if (time.GetUtcNow() - snapshot.FetchedAt > policy.Staleness)
        {
            refresher.TryStart(region, CatalogRunMode.Snapshot);
        }

        if (!query.HasIds)
        {
            return CatalogResult.Ready(snapshot);
        }

        var wanted = query.Ids.ToHashSet(StringComparer.Ordinal);

        return CatalogResult.Ready(snapshot with
        {
            Titles = snapshot.Titles.Where(title => wanted.Contains(title.Id)).ToList(),
        });
    }

    /// <summary>
    /// The versioned path: pin the active version, gate it on retention, and
    /// read through the version-keyed cache.
    /// </summary>
    private async Task<CatalogResult> GetNormalizedAsync(
        string region,
        CatalogPoolQuery query,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var active = await versions.FindActiveAsync(region, cancellationToken);

        if (active is null)
        {
            refresher.TryStart(region, CatalogRunMode.Normalized);
            return CatalogResult.NotReady();
        }

        // The retention gate (FR-015). A version with nothing observed inside
        // the limit is treated as absent rather than served old: provider
        // carriage data past the ceiling must not be returned at all.
        if (CatalogRetention.IsVersionExpired(active.LatestObservedAt, now))
        {
            await retention.PurgeAsync(region, now, cancellationToken);
            refresher.TryStart(region, CatalogRunMode.Normalized);
            return CatalogResult.NotReady();
        }

        if (now - active.FetchedAt > policy.Staleness)
        {
            refresher.TryStart(region, CatalogRunMode.Normalized);
        }

        var snapshot = await cache.GetOrLoadAsync(
            active.Id,
            query.CacheKey,
            token => reader.ReadAsync(active, query, token),
            cancellationToken);

        return CatalogResult.Ready(snapshot);
    }
}

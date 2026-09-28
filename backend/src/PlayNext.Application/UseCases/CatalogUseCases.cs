using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;

namespace PlayNext.Application.UseCases;

/// <summary>
/// The catalog policy: what a request is answered with, and when a retrieval
/// runs (research D10).
///
/// The two are deliberately separated. <see cref="GetAsync"/> is the whole of
/// the request path and touches only stored data, so it is fast and it is the
/// only thing a visitor ever waits for. <see cref="RefreshAsync"/> is the
/// expensive half, and it runs in the background — started by a request that
/// found nothing to serve, never awaited by one.
///
/// That split is what makes the deck's latency independent of the provider's.
/// </summary>
public sealed class CatalogUseCases(
    ICatalogProvider provider,
    ICatalogSnapshotStore store,
    ICatalogRefresher refresher,
    TimeProvider time,
    TimeSpan staleness)
{
    /// <summary>
    /// <c>GET /catalog</c> — the region's pool, or the honest "nothing has been
    /// retrieved yet".
    /// </summary>
    /// <remarks>
    /// A miss starts a retrieval and answers <see cref="CatalogResult.NotReady"/>
    /// rather than waiting: the visitor's next load gets titles (FR-014), which
    /// is one tap away and honest, where a spinner that may last a minute is
    /// neither. The start is attempted on every miss — <see cref="ICatalogRefresher"/>
    /// is what makes repeated attempts cost nothing.
    ///
    /// A <b>stale</b> snapshot is served and refreshed the same way, one state
    /// later: age bounds freshness, never availability (FR-004, FR-012). The
    /// visitor who happens to arrive when the bound has just passed gets the
    /// catalog from before it, not a spinner — and the batch that replaces it
    /// runs behind a response that has already been sent.
    /// </remarks>
    public async Task<CatalogResult> GetAsync(string region, CancellationToken cancellationToken)
    {
        if (await store.LoadAsync(region, cancellationToken) is { } snapshot)
        {
            // Measured from the instant the batch succeeded, not from when the
            // snapshot was last read: a catalog does not become fresh by being
            // popular, and a region with steady traffic would otherwise never
            // refresh at all.
            if (time.GetUtcNow() - snapshot.FetchedAt > staleness)
            {
                refresher.TryStart(region);
            }

            return CatalogResult.Ready(snapshot);
        }

        refresher.TryStart(region);

        return CatalogResult.NotReady();
    }

    /// <summary>
    /// Retrieves the region's pool and replaces its snapshot.
    /// </summary>
    /// <remarks>
    /// The snapshot is written only after the provider has returned a complete
    /// pool, and never a partial one: <see cref="ICatalogProvider.FetchAsync"/>
    /// either produces everything or throws, so a region's stored catalog is
    /// always a whole batch that succeeded. A failed run therefore leaves the
    /// previous snapshot exactly as it was (FR-013) — the guarantee the
    /// "showing cached titles" path depends on.
    ///
    /// Exceptions propagate. The caller is a background task, and its job is to
    /// log and let go; swallowing here would hide a provider that has been
    /// failing for a week.
    /// </remarks>
    public async Task RefreshAsync(string region, CancellationToken cancellationToken)
    {
        var titles = await provider.FetchAsync(region, cancellationToken);

        // A batch that came back with nothing is not a catalog, it is a
        // provider having a bad day — and storing it would replace a good
        // snapshot with an empty deck.
        if (titles.Count == 0)
        {
            return;
        }

        await store.SaveAsync(
            new CatalogSnapshot(region, time.GetUtcNow(), titles),
            cancellationToken);
    }
}

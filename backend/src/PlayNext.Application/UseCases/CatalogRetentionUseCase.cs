using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;

namespace PlayNext.Application.UseCases;

/// <summary>
/// Runs the retention purge at the points where it is safe: after a refresh has
/// promoted, and at startup (research D5, FR-015/016).
///
/// Deliberately thin: the rules live in <c>CatalogRetention</c> and the set
/// operations live in the store, so this class exists only to give both a
/// caller and a run log.
/// </summary>
public sealed class CatalogRetentionUseCase(
    ICatalogRetentionStore store,
    TimeProvider time)
{
    /// <summary>Purges one region and returns what was removed.</summary>
    public Task<CatalogRetentionOutcome> PurgeAsync(
        string region,
        CancellationToken cancellationToken) =>
        store.PurgeAsync(region, time.GetUtcNow(), cancellationToken);
}

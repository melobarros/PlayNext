using PlayNext.Application.Contracts;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// Purges what the provider's retention limit no longer allows us to keep, and
/// keeps referenced titles readable through the retired-title archive
/// (FR-015/016, research D5).
/// </summary>
public interface ICatalogRetentionStore
{
    /// <summary>
    /// Deletes the active version's expired rows, archives any the visitor still
    /// references (without availability), removes archive rows nothing
    /// references, and recomputes the version's <c>LatestObservedAt</c>.
    /// </summary>
    Task<CatalogRetentionOutcome> PurgeAsync(
        string region,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}

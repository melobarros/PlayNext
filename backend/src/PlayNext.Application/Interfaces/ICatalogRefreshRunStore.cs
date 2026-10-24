using PlayNext.Application.Contracts;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The operational record of a refresh or migration (FR-018).
///
/// Records scope, counts, and sanitized failures — never titles, payloads,
/// headers, or credentials.
/// </summary>
public interface ICatalogRefreshRunStore
{
    /// <summary>Creates a <c>Running</c> row and returns its id.</summary>
    Task<Guid> StartAsync(
        string region,
        CatalogRunKind kind,
        CatalogRunMode? mode,
        DateTimeOffset startedAt,
        CancellationToken cancellationToken);

    /// <summary>Writes the terminal status, counts, failures, and promoted version.</summary>
    Task CompleteAsync(
        Guid runId,
        CatalogRunOutcome outcome,
        DateTimeOffset completedAt,
        CancellationToken cancellationToken);

    /// <summary>The most recent run for a region, or <c>null</c> when it has never had one.</summary>
    Task<CatalogRunSummary?> LatestAsync(string region, CancellationToken cancellationToken);

    /// <summary>Marks runs that were still <c>Running</c> before <paramref name="cutoff"/> as <c>Abandoned</c>.</summary>
    Task<int> AbandonStaleAsync(DateTimeOffset cutoff, CancellationToken cancellationToken);
}

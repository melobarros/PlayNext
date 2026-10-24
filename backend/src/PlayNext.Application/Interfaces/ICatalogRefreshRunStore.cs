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

    /// <summary>
    /// Replaces a still-<c>Running</c> run's counts and failures with the slices
    /// finished so far, so the status endpoint can follow a run while it is in
    /// flight rather than only report it after the fact.
    ///
    /// A row that already has a terminal status is left untouched: a late
    /// progress write must not reopen the outcome.
    /// </summary>
    Task ProgressAsync(
        Guid runId,
        IReadOnlyDictionary<string, CatalogRunCounts> counts,
        IReadOnlyDictionary<string, string> failures,
        CancellationToken cancellationToken);

    /// <summary>The most recent run for a region, or <c>null</c> when it has never had one.</summary>
    Task<CatalogRunSummary?> LatestAsync(string region, CancellationToken cancellationToken);

    /// <summary>Marks runs that were still <c>Running</c> before <paramref name="cutoff"/> as <c>Abandoned</c>.</summary>
    Task<int> AbandonStaleAsync(DateTimeOffset cutoff, CancellationToken cancellationToken);
}

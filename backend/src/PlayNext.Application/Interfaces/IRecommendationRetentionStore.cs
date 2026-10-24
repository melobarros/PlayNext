namespace PlayNext.Application.Interfaces;

/// <summary>
/// Deletes recommendation events that have outlived the retention window
/// (FR-018, research D14).
///
/// Separate from <c>IRecommendationEventStore</c> on purpose: intake is
/// client-facing and must stay responsive, while purging is a bulk operation
/// that can take seconds and is allowed to fail quietly and try again tomorrow.
/// One interface serving both would make every intake caller depend on delete
/// semantics it never uses.
/// </summary>
public interface IRecommendationRetentionStore
{
    /// <summary>
    /// Deletes every impression received strictly before
    /// <paramref name="cutoff"/>, and its actions with it.
    /// </summary>
    /// <param name="cutoff">
    /// The oldest receipt time that may still be stored. Supplied rather than
    /// computed here so the boundary is testable without a database and the
    /// caller's clock is the only one involved.
    /// </param>
    /// <returns>How many impressions were deleted.</returns>
    Task<int> PurgeAsync(DateTimeOffset cutoff, CancellationToken cancellationToken);
}

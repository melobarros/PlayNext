using PlayNext.Application.Contracts;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The intake's only write path (FR-004, FR-008).
///
/// One call records one batch. It is idempotent by the events' client ids, so a
/// client retry is a no-op rather than a duplicate, and it never fails a batch
/// because one action could not be linked: that action is counted and skipped
/// (spec Edge Cases).
/// </summary>
public interface IRecommendationEventStore
{
    /// <summary>
    /// Stores the batch and reports what was actually inserted.
    /// </summary>
    /// <param name="batch">A batch already accepted by the validator.</param>
    /// <param name="userId">
    /// The account to attribute the events to, or null when the visitor was
    /// anonymous. Captured once so every event in the batch agrees.
    /// </param>
    /// <param name="receivedAt">
    /// The server's clock, captured once for the whole batch: it is what the
    /// replay and the 90-day purge order by, so a slow request must not spread
    /// one flush across two receipt times.
    /// </param>
    Task<RecommendationEventOutcome> RecordAsync(
        RecommendationEventBatch batch,
        Guid? userId,
        DateTimeOffset receivedAt,
        CancellationToken cancellationToken);
}

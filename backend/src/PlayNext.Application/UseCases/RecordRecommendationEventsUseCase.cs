using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.Validation;

namespace PlayNext.Application.UseCases;

/// <summary>
/// The intake, in the only order that is safe (T028).
///
/// **Validate, then limit, then store.** Validating first keeps a malformed
/// batch from spending the session's budget and from being answered with a
/// retry-after instead of the field list that would let the client fix itself.
/// Limiting before storing keeps a looping client from writing rows by looping.
/// And the store is the only thing that writes: this class decides, it does not
/// persist, so the whole ordering is readable from one method.
///
/// An empty batch is accepted as a no-op. The client flushes on a timer and
/// sometimes has nothing; a 400 there would make the transport count a failure
/// for a quiet deck, and the counters are meant to mean something was wrong.
/// </summary>
public sealed class RecordRecommendationEventsUseCase(
    IRecommendationEventStore store,
    IRecommendationIntakeLimiter limiter,
    TimeProvider time)
{
    public async Task<RecommendationIntakeResult> ExecuteAsync(
        RecommendationEventBatch? batch,
        Guid? userId,
        CancellationToken cancellationToken = default)
    {
        if (batch is null)
        {
            return RecommendationIntakeResult.Invalid(["The body is not a recommendation event batch."]);
        }

        var errors = RecommendationEventValidator.Validate(batch);
        if (errors.Count > 0) return RecommendationIntakeResult.Invalid(errors);

        var impressions = batch.Impressions ?? [];
        var actions = batch.Actions ?? [];

        if (impressions.Count == 0 && actions.Count == 0)
        {
            return RecommendationIntakeResult.Accepted(RecommendationEventOutcome.Empty);
        }

        // One clock reading for the whole batch. Received-at is the server's
        // answer to "when did this arrive", and reading the clock per row would
        // scatter one flush across several timestamps for no benefit — and let
        // the 90-day purge boundary depend on how long the inserts took.
        var now = time.GetUtcNow();

        // An action has no session id of its own: it belongs to the impression
        // it answers. A batch is therefore keyed by its first impression, and an
        // action-only batch has no key to limit against — refusing it would
        // drop a legitimate event instead of throttling one. The per-request
        // limits still bound how much such a batch can carry.
        var sessionId = impressions.Count > 0 ? impressions[0].SessionId : null;

        if (sessionId is not null
            && !limiter.TryAcquire(
                sessionId,
                impressions.Count + actions.Count,
                now,
                out var retryAfterSeconds))
        {
            return RecommendationIntakeResult.RateLimited(retryAfterSeconds);
        }

        var outcome = await store.RecordAsync(batch, userId, now, cancellationToken);
        return RecommendationIntakeResult.Accepted(outcome);
    }
}

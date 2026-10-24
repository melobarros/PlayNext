using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;

namespace PlayNext.Application.Tests;

/// <summary>
/// The intake use case (T028), against fakes.
///
/// The validator and the limiter have suites of their own; what is pinned here
/// is the order they are consulted in and what each outcome carries. The order
/// is the contract: a malformed event is refused before it can spend the
/// session's budget, and a refused budget never reaches the store — so a client
/// in a loop cannot write rows by looping, and cannot lock itself out by
/// sending garbage.
/// </summary>
public class RecordRecommendationEventsUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 18, 0, 0, TimeSpan.Zero);

    private static readonly Guid Account = Guid.Parse("4b1c2f3e-5d6a-4b8c-9e0f-1a2b3c4d5e6f");

    private const string ValidTimestamp = "2026-10-24T18:00:00.000Z";

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class RecordingStore : IRecommendationEventStore
    {
        public int Calls { get; private set; }

        public Guid? UserId { get; private set; }

        public DateTimeOffset ReceivedAt { get; private set; }

        public RecommendationEventBatch? Batch { get; private set; }

        public RecommendationEventOutcome Result { get; set; } = new(1, 1, 0, 0);

        public Task<RecommendationEventOutcome> RecordAsync(
            RecommendationEventBatch batch,
            Guid? userId,
            DateTimeOffset receivedAt,
            CancellationToken cancellationToken)
        {
            Calls++;
            Batch = batch;
            UserId = userId;
            ReceivedAt = receivedAt;
            return Task.FromResult(Result);
        }
    }

    private sealed class AlwaysRefusingLimiter(int retryAfter) : IRecommendationIntakeLimiter
    {
        public int Calls { get; private set; }

        public string? LastSessionId { get; private set; }

        public int LastEventCount { get; private set; }

        public bool TryAcquire(string sessionId, int eventCount, DateTimeOffset now, out int retryAfterSeconds)
        {
            Calls++;
            LastSessionId = sessionId;
            LastEventCount = eventCount;
            retryAfterSeconds = retryAfter;
            return false;
        }
    }

    private sealed class AlwaysAdmittingLimiter : IRecommendationIntakeLimiter
    {
        public int Calls { get; private set; }

        public string? LastSessionId { get; private set; }

        public int LastEventCount { get; private set; }

        public bool TryAcquire(string sessionId, int eventCount, DateTimeOffset now, out int retryAfterSeconds)
        {
            Calls++;
            LastSessionId = sessionId;
            LastEventCount = eventCount;
            retryAfterSeconds = 0;
            return true;
        }
    }

    private static RecordRecommendationEventsUseCase UseCase(
        RecordingStore store,
        IRecommendationIntakeLimiter limiter) =>
        new(store, limiter, new FixedTime());

    private static RecommendationImpressionInput Impression(
        string clientEventId = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0",
        string sessionId = "6d1c2f3e-5d6a-4b8c-9e0f-1a2b3c4d5e6f",
        string titleId = "arrival") =>
        new(
            Guid.Parse(clientEventId),
            sessionId,
            titleId,
            "deck",
            1,
            "recommend-v1",
            "2026-10-24T17:07:32.000Z",
            "0123456789abcdef",
            7.5,
            "none",
            ValidTimestamp);

    private static RecommendationActionInput Action(
        string clientEventId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        string impressionClientEventId = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0",
        string kind = "liked",
        int dwellMs = 2400) =>
        new(Guid.Parse(clientEventId), Guid.Parse(impressionClientEventId), kind, dwellMs, ValidTimestamp);

    private static RecommendationEventBatch Batch(
        RecommendationImpressionInput[]? impressions = null,
        RecommendationActionInput[]? actions = null) =>
        new(impressions ?? [Impression()], actions ?? [Action()]);

    [Fact]
    public async Task A_valid_batch_reaches_the_store_and_returns_its_outcome()
    {
        var store = new RecordingStore { Result = new(1, 1, 0, 0) };

        var result = await UseCase(store, new AlwaysAdmittingLimiter()).ExecuteAsync(Batch(), null);

        Assert.Equal(RecommendationIntakeStatus.Accepted, result.Status);
        Assert.Equal(1, store.Calls);
        Assert.Equal(1, result.Outcome.AcceptedImpressions);
        Assert.Equal(1, result.Outcome.AcceptedActions);
        Assert.Empty(result.Errors);
        Assert.Equal(0, result.RetryAfterSeconds);
    }

    [Fact]
    public async Task The_account_id_reaches_the_store_unchanged()
    {
        var store = new RecordingStore();

        await UseCase(store, new AlwaysAdmittingLimiter())
            .ExecuteAsync(Batch(), Account);

        Assert.Equal(Account, store.UserId);
    }

    [Fact]
    public async Task An_anonymous_batch_reaches_the_store_with_no_account()
    {
        // Null is the guest case, and it has to survive the trip: the store
        // decides nullability, and a use case that substituted Guid.Empty would
        // write a fake account id onto every guest impression.
        var store = new RecordingStore();

        await UseCase(store, new AlwaysAdmittingLimiter()).ExecuteAsync(Batch(), null);

        Assert.Null(store.UserId);
    }

    [Fact]
    public async Task One_server_timestamp_serves_the_whole_batch()
    {
        // Received-at is the server's answer to "when did this arrive", not a
        // per-event claim: reading the clock per row would split one flush
        // across several timestamps for no reason and make the purge boundary
        // depend on loop timing.
        var store = new RecordingStore();

        await UseCase(store, new AlwaysAdmittingLimiter()).ExecuteAsync(Batch(), null);

        Assert.Equal(Now, store.ReceivedAt);
    }

    [Fact]
    public async Task The_batch_reaches_the_store_as_submitted()
    {
        // The use case is not a second normalizer: a field it rewrote here
        // would be a field the response described differently from what was
        // stored.
        var store = new RecordingStore();
        var batch = Batch();

        await UseCase(store, new AlwaysAdmittingLimiter()).ExecuteAsync(batch, null);

        Assert.Same(batch, store.Batch);
    }

    [Fact]
    public async Task An_invalid_batch_never_reaches_the_store()
    {
        var store = new RecordingStore();
        var limiter = new AlwaysAdmittingLimiter();

        var result = await UseCase(store, limiter).ExecuteAsync(
            Batch(impressions: [Impression() with { Position = 0 }]), null);

        Assert.Equal(RecommendationIntakeStatus.Invalid, result.Status);
        Assert.Equal(0, store.Calls);
        Assert.Equal(0, limiter.Calls);
        Assert.Equal(RecommendationEventOutcome.Empty, result.Outcome);
    }

    [Fact]
    public async Task An_invalid_batch_keeps_the_validators_errors()
    {
        var result = await UseCase(new RecordingStore(), new AlwaysAdmittingLimiter())
            .ExecuteAsync(Batch(actions: [Action(kind: "loved")]), null);

        Assert.Equal(RecommendationIntakeStatus.Invalid, result.Status);
        Assert.Equal("actions[0].kind is not a recommendation action.", Assert.Single(result.Errors));
    }

    [Fact]
    public async Task An_invalid_batch_does_not_spend_the_session_budget()
    {
        // The reverse order — limit, then validate — would let a client that
        // sends malformed batches exhaust its own window and then be told to
        // wait before it is told what was wrong.
        var limiter = new AlwaysAdmittingLimiter();

        await UseCase(new RecordingStore(), limiter)
            .ExecuteAsync(Batch(impressions: [Impression() with { Surface = "watchlist" }]), null);

        Assert.Equal(0, limiter.Calls);
    }

    [Fact]
    public async Task A_refused_limit_returns_a_retry_after_and_never_reaches_the_store()
    {
        var store = new RecordingStore();

        var result = await UseCase(store, new AlwaysRefusingLimiter(retryAfter: 42))
            .ExecuteAsync(Batch(), null);

        Assert.Equal(RecommendationIntakeStatus.RateLimited, result.Status);
        Assert.Equal(42, result.RetryAfterSeconds);
        Assert.Equal(0, store.Calls);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task The_limit_counts_impressions_and_actions_together()
    {
        // An action is a row too. Counting only impressions would let a client
        // inside its impression budget double its write volume with actions.
        var limiter = new AlwaysAdmittingLimiter();

        await UseCase(new RecordingStore(), limiter).ExecuteAsync(
            Batch(
                impressions: [Impression(), Impression(clientEventId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", titleId: "dune")],
                actions: [Action()]),
            null);

        Assert.Equal(3, limiter.LastEventCount);
    }

    [Fact]
    public async Task The_limit_is_keyed_by_the_batchs_session()
    {
        var limiter = new AlwaysAdmittingLimiter();

        await UseCase(new RecordingStore(), limiter)
            .ExecuteAsync(Batch(impressions: [Impression(sessionId: "the-tabs-session")]), null);

        Assert.Equal("the-tabs-session", limiter.LastSessionId);
    }

    [Fact]
    public async Task An_empty_batch_is_a_no_op()
    {
        // The transport flushes whatever it has, including nothing, after a
        // quiet stretch. That is not an error and not worth a row or a window
        // slot: the client is told it succeeded and nothing happens.
        var store = new RecordingStore();
        var limiter = new AlwaysAdmittingLimiter();

        var result = await UseCase(store, limiter)
            .ExecuteAsync(new RecommendationEventBatch([], []), null);

        Assert.Equal(RecommendationIntakeStatus.Accepted, result.Status);
        Assert.Equal(RecommendationEventOutcome.Empty, result.Outcome);
        Assert.Equal(0, store.Calls);
        Assert.Equal(0, limiter.Calls);
    }

    [Fact]
    public async Task An_absent_array_reads_as_an_empty_one()
    {
        // JSON `{}` deserializes both arrays to null; that is a client sending
        // nothing, not a missing field to complain about.
        var result = await UseCase(new RecordingStore(), new AlwaysAdmittingLimiter())
            .ExecuteAsync(new RecommendationEventBatch(null, null), null);

        Assert.Equal(RecommendationIntakeStatus.Accepted, result.Status);
    }

    [Fact]
    public async Task An_action_only_batch_is_accepted_without_a_limit()
    {
        // There is no session id on an action — it belongs to the impression it
        // answers. Without a key there is no window to consult, and refusing
        // the batch would drop a legitimate action rather than throttle one.
        var store = new RecordingStore();
        var limiter = new AlwaysRefusingLimiter(retryAfter: 60);

        var result = await UseCase(store, limiter)
            .ExecuteAsync(new RecommendationEventBatch([], [Action()]), null);

        Assert.Equal(RecommendationIntakeStatus.Accepted, result.Status);
        Assert.Equal(0, limiter.Calls);
        Assert.Equal(1, store.Calls);
    }

    [Fact]
    public async Task The_validator_runs_before_the_store_for_every_bad_field()
    {
        // The suite above proves the ordering once per rule; this pins that no
        // single bad field is special-cased into the store path.
        var bad = new[]
        {
            Impression() with { Position = -1 },
            Impression() with { ReasonCode = "free text" },
            Impression() with { ShownAt = "yesterday" },
            Impression() with { Score = double.NaN },
        };

        foreach (var impression in bad)
        {
            var store = new RecordingStore();

            var result = await UseCase(store, new AlwaysAdmittingLimiter())
                .ExecuteAsync(Batch(impressions: [impression]), null);

            Assert.Equal(RecommendationIntakeStatus.Invalid, result.Status);
            Assert.Equal(0, store.Calls);
        }
    }
}

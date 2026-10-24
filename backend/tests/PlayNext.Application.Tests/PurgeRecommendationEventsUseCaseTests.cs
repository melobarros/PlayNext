using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Domain;

namespace PlayNext.Application.Tests;

/// <summary>
/// The purge use case (T054), against fakes.
///
/// What is pinned here is the one decision the use case makes: *which instant*
/// it calls the cutoff. The boundary rule itself lives in
/// <see cref="RecommendationRetention"/> and the set operations in the store, so
/// this class is thin on purpose — and the failure path is asserted to
/// propagate, because "log and carry on" is the hosted service's decision, not
/// the use case's.
/// </summary>
public class PurgeRecommendationEventsUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 18, 0, 0, TimeSpan.Zero);

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class RecordingStore : IRecommendationRetentionStore
    {
        public int Calls { get; private set; }

        public DateTimeOffset? Cutoff { get; private set; }

        public CancellationToken Token { get; private set; }

        public int Result { get; set; }

        public Exception? Throws { get; set; }

        public Task<int> PurgeAsync(DateTimeOffset cutoff, CancellationToken cancellationToken)
        {
            Calls++;
            Cutoff = cutoff;
            Token = cancellationToken;

            if (Throws is not null) return Task.FromException<int>(Throws);

            return Task.FromResult(Result);
        }
    }

    [Fact]
    public async Task The_cutoff_is_ninety_days_before_the_clock()
    {
        var store = new RecordingStore();

        await new PurgeRecommendationEventsUseCase(store, new FixedTime()).PurgeAsync(default);

        Assert.Equal(RecommendationRetention.Cutoff(Now), store.Cutoff);
        Assert.Equal(Now - TimeSpan.FromDays(90), store.Cutoff);
    }

    [Fact]
    public async Task The_count_reaches_the_caller()
    {
        // The hosted service logs it, and an operator reading the log needs to
        // tell "purged nothing because nothing was old" from "did not run".
        var store = new RecordingStore { Result = 37 };

        var deleted = await new PurgeRecommendationEventsUseCase(store, new FixedTime()).PurgeAsync(default);

        Assert.Equal(37, deleted);
        Assert.Equal(1, store.Calls);
    }

    [Fact]
    public async Task The_caller_controls_the_cancellation()
    {
        var store = new RecordingStore();
        using var cancellation = new CancellationTokenSource();

        await new PurgeRecommendationEventsUseCase(store, new FixedTime()).PurgeAsync(cancellation.Token);

        Assert.Equal(cancellation.Token, store.Token);
    }

    [Fact]
    public async Task A_store_failure_reaches_the_caller()
    {
        // Swallowing it here would leave the hosted service unable to tell a
        // completed purge from a failed one, and it would log success on a pass
        // that deleted nothing.
        var store = new RecordingStore { Throws = new InvalidOperationException("the database is away") };

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(
            () => new PurgeRecommendationEventsUseCase(store, new FixedTime()).PurgeAsync(default));

        Assert.Equal("the database is away", failure.Message);
    }
}

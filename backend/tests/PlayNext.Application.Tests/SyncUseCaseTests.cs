using PlayNext.Application.Contracts;
using PlayNext.Application.UseCases;
using PlayNext.Domain;

namespace PlayNext.Application.Tests;

/// <summary>
/// The sync use case (T031), against fakes.
///
/// The merge rule is <see cref="MergeService"/>'s and is settled in the domain
/// suite. What is pinned here is everything around it: that a body names *items*
/// and never describes a whole document, that a refused body writes nothing, and
/// that the response is the merged account rather than the body echoed back.
///
/// Partial-ness is the load-bearing part. <c>POST /me/sync</c> is one endpoint
/// for three callers — a live change, an offline replay, and a migration — and
/// the live caller sends only what changed. An implementation that read an
/// absent collection as "empty this out" would wipe the visitor's account on the
/// first single-title push, and would do it while answering 200.
/// </summary>
public class SyncUseCaseTests
{
    private static readonly Guid User = Guid.Parse("0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11");

    private static readonly DateTimeOffset Earlier = new(2026, 9, 27, 10, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset Later = new(2026, 9, 27, 10, 5, 0, TimeSpan.Zero);

    /// <summary>Round-trips in the wire format the validator reads.</summary>
    private static string Wire(DateTimeOffset at) => at.ToString("O");

    private sealed class Harness
    {
        public InMemoryAccountStateRepository States { get; } = new();

        public StateUseCases UseCases => new(States);

        /// <summary>Puts the account where a previous session left it.</summary>
        public Task AccountHolds(AccountState state) =>
            States.MergeIntoAccountAsync(User, state, CancellationToken.None);

        public Task<SyncResult> Sync(GuestStatePayload? body) =>
            UseCases.SyncAsync(User, body, CancellationToken.None);
    }

    private static AccountState AccountWith(
        (string TitleId, InteractionState State, DateTimeOffset At)[] ratings,
        (string TitleId, DateTimeOffset At)[]? history = null,
        PreferenceRecord? preferences = null)
    {
        return new AccountState(
            ratings.ToDictionary(
                entry => entry.TitleId,
                entry => new InteractionRecord(entry.State, entry.At),
                StringComparer.Ordinal),
            [.. (history ?? []).Select(entry => new WatchHistoryEntry(entry.TitleId, entry.At))],
            preferences);
    }

    private static GuestStatePayload Body(
        (string TitleId, string State, DateTimeOffset At)[]? interactions = null,
        (string TitleId, DateTimeOffset At)[]? history = null,
        PreferencePayload? preferences = null,
        (string TitleId, DateTimeOffset At)[]? removals = null)
    {
        return new GuestStatePayload(
            interactions?.ToDictionary(
                entry => entry.TitleId,
                entry => new InteractionPayload(entry.State, Wire(entry.At)),
                StringComparer.Ordinal),
            history?.Select(entry => new HistoryPayload(entry.TitleId, Wire(entry.At))).ToList(),
            preferences,
            removals?.Select(entry => new RemovalPayload(entry.TitleId, Wire(entry.At))).ToList());
    }

    public class APartialBodyLeavesTheRestAlone
    {
        [Fact]
        public async Task A_collection_the_body_omits_is_untouched()
        {
            var harness = new Harness();
            await harness.AccountHolds(
                AccountWith(
                    [("arrival", InteractionState.Loved, Earlier)],
                    [("arrival", Earlier)],
                    new PreferenceRecord(
                        new DimensionChoice(["movie"], Any: false),
                        DimensionChoice.NoPreference,
                        DimensionChoice.NoPreference,
                        IncludeUnownedProviders: false,
                        CompletedAt: Earlier,
                        UpdatedAt: Earlier)));

            var result = await harness.Sync(Body(interactions: [("dune", "wantToWatch", Later)]));

            Assert.True(result.Succeeded, string.Join("; ", result.Errors));
            Assert.Equal(2, result.State!.Interactions.Count);
            Assert.Single(result.State.History);
            Assert.NotNull(result.State.Preferences);
        }

        [Fact]
        public async Task The_response_is_the_merged_account_not_the_body_echoed_back()
        {
            // What the client writes back to its cache is the account, so a
            // response carrying only the pushed item would leave the device
            // believing that is all it owns.
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([("arrival", InteractionState.Loved, Earlier)]));

            var result = await harness.Sync(Body(interactions: [("dune", "wantToWatch", Later)]));

            Assert.Equal(["arrival", "dune"], result.State!.Interactions.Keys.Order().ToList());
        }
    }

    public class ConflictsResolveByTime
    {
        [Fact]
        public async Task A_newer_rating_replaces_the_stored_one()
        {
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([("arrival", InteractionState.Disliked, Earlier)]));

            var result = await harness.Sync(Body(interactions: [("arrival", "loved", Later)]));

            Assert.Equal(InteractionState.Loved, result.State!.Interactions["arrival"].State);
        }

        [Fact]
        public async Task An_older_rating_loses_to_the_stored_one()
        {
            // FR-017: a replay must not undo a change made elsewhere in the
            // meantime. The queue exists precisely because this arrives late.
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([("arrival", InteractionState.Loved, Later)]));

            var result = await harness.Sync(Body(interactions: [("arrival", "disliked", Earlier)]));

            Assert.Equal(InteractionState.Loved, result.State!.Interactions["arrival"].State);
        }
    }

    public class ARefusedBodyWritesNothing
    {
        [Fact]
        public async Task An_unknown_state_refuses_the_whole_body()
        {
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([("arrival", InteractionState.Loved, Earlier)]));

            var result = await harness.Sync(
                Body(
                    interactions:
                    [
                        ("dune", "wantToWatch", Later),
                        ("hereditary", "adored", Later),
                    ]));

            Assert.False(result.Succeeded);
            Assert.Null(result.State);
            Assert.Contains(result.Errors, error => error.Contains("adored"));
        }

        [Fact]
        public async Task The_account_is_left_exactly_as_it_was()
        {
            // The other half of the assertion above, and the one FR-007 is
            // about: a body refused *after* one good item must not have applied
            // that item on the way to noticing the bad one.
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([("arrival", InteractionState.Loved, Earlier)]));

            await harness.Sync(
                Body(
                    interactions:
                    [
                        ("dune", "wantToWatch", Later),
                        ("hereditary", "adored", Later),
                    ]));

            Assert.Equal(["arrival"], harness.States.Stored(User).Interactions.Keys.ToList());

            // Then the same call with the bad item removed does reach storage.
            // Without this half, "nothing was written" is equally consistent
            // with an implementation that never writes anything at all.
            await harness.Sync(Body(interactions: [("dune", "wantToWatch", Later)]));

            Assert.Equal(
                ["arrival", "dune"],
                harness.States.Stored(User).Interactions.Keys.Order().ToList());
        }
    }

    public class TheWatchingLogIsIdempotent
    {
        [Fact]
        public async Task The_same_pair_arriving_twice_is_logged_once()
        {
            // A retried migration re-sends the whole guest document, so the same
            // (titleId, chosenAt) pair is expected to arrive more than once.
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([], [("arrival", Earlier)]));

            var result = await harness.Sync(Body(history: [("arrival", Earlier)]));

            Assert.Single(result.State!.History);
        }

        [Fact]
        public async Task The_same_title_watched_twice_stays_two_entries()
        {
            // Deduping by title would erase a rewatch, which is the thing the
            // log is for.
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([], [("arrival", Earlier)]));

            var result = await harness.Sync(Body(history: [("arrival", Later)]));

            Assert.Equal(2, result.State!.History.Count);
        }
    }

    public class RemovalsAreApplied
    {
        [Fact]
        public async Task A_removal_newer_than_the_stored_rating_drops_it()
        {
            // A second title is along for the ride so that "the account is
            // empty" cannot pass for "the right title went": an implementation
            // that dropped everything on any removal would otherwise satisfy
            // this.
            var harness = new Harness();
            await harness.AccountHolds(
                AccountWith(
                    [
                        ("hereditary", InteractionState.Disliked, Earlier),
                        ("arrival", InteractionState.Loved, Earlier),
                    ]));

            var result = await harness.Sync(Body(removals: [("hereditary", Later)]));

            Assert.Equal(["arrival"], result.State!.Interactions.Keys.ToList());
        }

        [Fact]
        public async Task The_merged_account_carries_no_removal_of_its_own()
        {
            // A removal is an instruction, not a fact about the account. Handing
            // one back would invite the next caller to apply it a second time.
            var harness = new Harness();
            await harness.AccountHolds(AccountWith([("hereditary", InteractionState.Disliked, Earlier)]));

            var result = await harness.Sync(Body(removals: [("hereditary", Later)]));

            // First that the removal was applied at all — otherwise the
            // assertion below holds just as well for an implementation that
            // never looked at `removals`.
            Assert.Empty(result.State!.Interactions);
            Assert.Empty(result.State.Removals);
        }
    }
}

using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The guest→account merge — the feature's named critical path (constitution V),
/// so these tests were written before <see cref="MergeService"/> had a body.
///
/// They assert the spec's Assumptions verbatim ("union plus newest-wins… the
/// newer action, which supersedes the older one") plus the two decisions the
/// spec left open and research D4 fixed: the exact-tie rule and history
/// idempotency. The tie-break test is the one worth reading — an
/// implementation that let enumeration order decide would pass every other test
/// here and still be non-deterministic.
/// </summary>
public class MergeServiceTests
{
    private static readonly DateTimeOffset Older = new(2026, 9, 20, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Newer = new(2026, 9, 25, 10, 0, 0, TimeSpan.Zero);

    private static AccountState StateWith(
        (string TitleId, InteractionState State, DateTimeOffset At)[] interactions,
        (string TitleId, DateTimeOffset At)[]? history = null,
        PreferenceRecord? preferences = null)
    {
        return new AccountState(
            interactions.ToDictionary(
                entry => entry.TitleId,
                entry => new InteractionRecord(entry.State, entry.At),
                StringComparer.Ordinal),
            (history ?? []).Select(entry => new WatchHistoryEntry(entry.TitleId, entry.At)).ToList(),
            preferences);
    }

    private static PreferenceRecord PreferencesAt(DateTimeOffset updatedAt, string genre)
    {
        return new PreferenceRecord(
            new DimensionChoice(["movie"], false),
            new DimensionChoice([genre], false),
            new DimensionChoice(["netflix"], false),
            IncludeUnownedProviders: false,
            CompletedAt: updatedAt,
            UpdatedAt: updatedAt);
    }

    public class KeepsEverythingEitherSideKnows
    {
        [Fact]
        public void Titles_unique_to_the_device_are_added()
        {
            var account = StateWith([("arrival", InteractionState.Loved, Older)]);
            var device = StateWith([("dune-part-two", InteractionState.WantToWatch, Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(
                [InteractionState.Loved, InteractionState.WantToWatch],
                merged.Interactions.Values.Select(record => record.State).Order().ToList());
            Assert.Equal(2, merged.Interactions.Count);
        }

        [Fact]
        public void Titles_unique_to_the_account_are_kept()
        {
            var account = StateWith([("arrival", InteractionState.Loved, Older)]);
            var device = StateWith([("dune-part-two", InteractionState.WantToWatch, Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.True(merged.Interactions.ContainsKey("arrival"));
        }

        [Fact]
        public void A_guest_with_nothing_registers_into_an_empty_account()
        {
            var merged = MergeService.Merge(AccountState.Empty, AccountState.Empty);

            Assert.Empty(merged.Interactions);
            Assert.Empty(merged.History);
            Assert.Null(merged.Preferences);
        }
    }

    public class NewerActionWins
    {
        [Fact]
        public void The_newer_device_rating_supersedes_the_older_account_one()
        {
            var account = StateWith([("arrival", InteractionState.Loved, Older)]);
            var device = StateWith([("arrival", InteractionState.Disliked, Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(InteractionState.Disliked, merged.Interactions["arrival"].State);
        }

        [Fact]
        public void The_newer_account_rating_supersedes_the_older_device_one()
        {
            var account = StateWith([("arrival", InteractionState.Disliked, Newer)]);
            var device = StateWith([("arrival", InteractionState.Loved, Older)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(InteractionState.Disliked, merged.Interactions["arrival"].State);
        }

        [Fact]
        public void The_winner_keeps_its_own_timestamp_not_the_losers()
        {
            var account = StateWith([("arrival", InteractionState.Loved, Older)]);
            var device = StateWith([("arrival", InteractionState.Disliked, Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(Newer, merged.Interactions["arrival"].UpdatedAt);
        }
    }

    public class TiesGoToTheAccount
    {
        // Research D4. Without an explicit tie-break the result depends on
        // enumeration order, which constitution VI forbids: the same two inputs
        // must always produce the same output.

        [Fact]
        public void An_exact_timestamp_tie_keeps_the_accounts_rating()
        {
            var account = StateWith([("arrival", InteractionState.Loved, Older)]);
            var device = StateWith([("arrival", InteractionState.Disliked, Older)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(InteractionState.Loved, merged.Interactions["arrival"].State);
        }

        [Fact]
        public void The_tie_rule_is_symmetric_in_argument_order()
        {
            // Same two conflicting inputs, merged both ways round: the account's
            // value wins both times, so the outcome depends only on which side
            // is the account — never on which was passed first.
            var loved = StateWith([("arrival", InteractionState.Loved, Older)]);
            var disliked = StateWith([("arrival", InteractionState.Disliked, Older)]);

            Assert.Equal(
                InteractionState.Loved,
                MergeService.Merge(loved, disliked).Interactions["arrival"].State);
            Assert.Equal(
                InteractionState.Disliked,
                MergeService.Merge(disliked, loved).Interactions["arrival"].State);
        }

        [Fact]
        public void An_exact_tie_on_preferences_keeps_the_accounts()
        {
            var account = StateWith([], preferences: PreferencesAt(Older, "horror"));
            var device = StateWith([], preferences: PreferencesAt(Older, "comedy"));

            var merged = MergeService.Merge(account, device);

            Assert.Equal("horror", merged.Preferences!.Genre.Values[0]);
        }
    }

    public class TheWatchingLog
    {
        [Fact]
        public void Entries_from_both_sides_are_all_kept()
        {
            var account = StateWith([], [("arrival", Older)]);
            var device = StateWith([], [("dune-part-two", Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(
                ["arrival", "dune-part-two"],
                merged.History.Select(entry => entry.TitleId).Order().ToList());
        }

        [Fact]
        public void Re_uploading_the_same_entry_does_not_duplicate_it()
        {
            // What makes a retried migration idempotent (FR-007, SC-004): the
            // device's document is uploaded again after a failure, and the log
            // must not grow a second copy of a choice that already happened.
            var account = StateWith([], [("arrival", Older)]);
            var device = StateWith([], [("arrival", Older)]);

            var merged = MergeService.Merge(account, device);

            Assert.Single(merged.History);
        }

        [Fact]
        public void The_same_title_watched_twice_is_two_entries()
        {
            // 002/003: the log records what happened, so watching the same title
            // on two occasions is two facts, not a duplicate.
            var account = StateWith([], [("arrival", Older)]);
            var device = StateWith([], [("arrival", Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(2, merged.History.Count);
        }

        [Fact]
        public void Merging_never_removes_an_entry()
        {
            var account = StateWith([], [("arrival", Older), ("get-out", Older)]);
            var device = StateWith([], [("dune-part-two", Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal(3, merged.History.Count);
        }
    }

    public class PreferencesAreWholeDocument
    {
        [Fact]
        public void The_newer_preferences_replace_the_older_ones_entirely()
        {
            var account = StateWith([], preferences: PreferencesAt(Older, "horror"));
            var device = StateWith([], preferences: PreferencesAt(Newer, "comedy"));

            var merged = MergeService.Merge(account, device);

            Assert.Equal("comedy", merged.Preferences!.Genre.Values[0]);
            Assert.Equal(Newer, merged.Preferences.UpdatedAt);
        }

        [Fact]
        public void Older_device_preferences_do_not_overwrite_newer_account_ones()
        {
            var account = StateWith([], preferences: PreferencesAt(Newer, "horror"));
            var device = StateWith([], preferences: PreferencesAt(Older, "comedy"));

            var merged = MergeService.Merge(account, device);

            Assert.Equal("horror", merged.Preferences!.Genre.Values[0]);
        }

        [Fact]
        public void A_side_with_no_preferences_does_not_erase_the_others()
        {
            // The guest who never finished the quiz must not blank the account's
            // preferences — "nothing else is lost" (US3).
            var account = StateWith([], preferences: PreferencesAt(Older, "horror"));
            var device = StateWith([]);

            var merged = MergeService.Merge(account, device);

            Assert.Equal("horror", merged.Preferences!.Genre.Values[0]);
        }

        [Fact]
        public void Preferences_are_never_field_merged()
        {
            // Research D4: field-merging could produce a combination the visitor
            // never chose. The device's newer document wins whole, so its
            // provider list comes with it.
            var account = StateWith([], preferences: PreferencesAt(Older, "horror"));
            var device = StateWith([], preferences: PreferencesAt(Newer, "comedy"));

            var merged = MergeService.Merge(account, device);

            Assert.Equal(["netflix"], merged.Preferences!.Provider.Values);
        }
    }

    public class Purity
    {
        [Fact]
        public void Merging_does_not_modify_either_input()
        {
            // FR-007's recoverability rests on this: if a failed migration could
            // mutate the device's state, "the guest data stays intact" would be
            // a hope rather than a property.
            var account = StateWith([("arrival", InteractionState.Loved, Older)]);
            var device = StateWith([("dune-part-two", InteractionState.Disliked, Newer)]);

            MergeService.Merge(account, device);

            Assert.Single(account.Interactions);
            Assert.Single(device.Interactions);
        }

        [Fact]
        public void A_merge_into_an_empty_account_returns_the_devices_data_unchanged()
        {
            var device = StateWith(
                [("arrival", InteractionState.Loved, Older), ("get-out", InteractionState.Disliked, Newer)],
                [("arrival", Older)],
                PreferencesAt(Older, "horror"));

            var merged = MergeService.Merge(AccountState.Empty, device);

            Assert.Equal(2, merged.Interactions.Count);
            Assert.Single(merged.History);
            Assert.Equal("horror", merged.Preferences!.Genre.Values[0]);
        }
    }

    public class ExclusionsSurvive
    {
        [Fact]
        public void Disliked_titles_from_either_side_stay_excluded()
        {
            // US3 scenario 4: no excluded title sneaks back into the deck after
            // a merge.
            var account = StateWith([("hereditary", InteractionState.Disliked, Older)]);
            var device = StateWith([("midnight-static", InteractionState.NotInterested, Newer)]);

            var merged = MergeService.Merge(account, device);

            Assert.Contains("hereditary", merged.ExcludedTitleIds);
            Assert.Contains("midnight-static", merged.ExcludedTitleIds);
        }

        [Fact]
        public void A_loved_title_is_not_excluded()
        {
            var merged = MergeService.Merge(
                AccountState.Empty,
                StateWith([("arrival", InteractionState.Loved, Older)]));

            Assert.DoesNotContain("arrival", merged.ExcludedTitleIds);
        }
    }
}

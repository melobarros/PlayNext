using PlayNext.Application.Contracts;
using PlayNext.Application.Validation;
using PlayNext.Domain;

namespace PlayNext.Application.Tests;

/// <summary>
/// Payload validation — the server's half of the 002 storage contract's
/// rejection rules (data-model.md "Validation rules").
///
/// The tests that matter most are the ones asserting a *whole* document is
/// refused. An implementation that skipped the entries it did not recognize
/// would pass a naive "is this state rejected?" test while silently changing
/// which titles the deck excludes — the exact defect the device-side contract
/// was written to prevent.
/// </summary>
public class GuestStateValidatorTests
{
    private const string ValidTimestamp = "2026-09-27T10:00:00Z";

    private static GuestStatePayload Document(
        Dictionary<string, InteractionPayload>? interactions = null,
        List<HistoryPayload>? history = null,
        PreferencePayload? preferences = null,
        List<RemovalPayload>? removals = null)
    {
        return new GuestStatePayload(interactions, history, preferences, removals);
    }

    private static PreferencePayload Preferences(string updatedAt = ValidTimestamp)
    {
        return new PreferencePayload(
            new DimensionChoicePayload(["movie"], false),
            new DimensionChoicePayload(["sci-fi"], false),
            new DimensionChoicePayload(["netflix"], false),
            IncludeUnownedProviders: false,
            CompletedAt: updatedAt,
            UpdatedAt: updatedAt);
    }

    public class TheHappyPath
    {
        [Fact]
        public void A_well_formed_document_becomes_the_domain_shape()
        {
            var document = Document(
                new() { ["arrival"] = new("loved", ValidTimestamp) },
                [new HistoryPayload("arrival", ValidTimestamp)],
                Preferences());

            var outcome = GuestStateValidator.Validate(document);

            Assert.True(outcome.IsValid, string.Join("; ", outcome.Errors));
            Assert.Equal(InteractionState.Loved, outcome.Value!.Interactions["arrival"].State);
            Assert.Equal(
                new DateTimeOffset(2026, 9, 27, 10, 0, 0, TimeSpan.Zero),
                outcome.Value.Interactions["arrival"].UpdatedAt);
            Assert.Single(outcome.Value.History);
            Assert.Equal(["movie"], outcome.Value.Preferences!.MediaType.Values);
        }

        [Theory]
        [InlineData("loved", InteractionState.Loved)]
        [InlineData("liked", InteractionState.Liked)]
        [InlineData("disliked", InteractionState.Disliked)]
        [InlineData("wantToWatch", InteractionState.WantToWatch)]
        [InlineData("notInterested", InteractionState.NotInterested)]
        [InlineData("watchingNow", InteractionState.WatchingNow)]
        public void Every_vocabulary_state_is_accepted(string wire, InteractionState expected)
        {
            var document = Document(new() { ["arrival"] = new(wire, ValidTimestamp) });

            var outcome = GuestStateValidator.Validate(document);

            Assert.True(outcome.IsValid, string.Join("; ", outcome.Errors));
            Assert.Equal(expected, outcome.Value!.Interactions["arrival"].State);
        }

        [Fact]
        public void Excluded_states_stay_excluded_after_validation()
        {
            // The Feedback Loop invariant survives the trip through the wire
            // format: whatever the server stores, the deck must not re-suggest
            // what the visitor already rejected.
            var document = Document(new()
            {
                ["hereditary"] = new("disliked", ValidTimestamp),
                ["midnight-static"] = new("notInterested", ValidTimestamp),
                ["arrival"] = new("loved", ValidTimestamp),
            });

            var outcome = GuestStateValidator.Validate(document);

            Assert.Equal(
                ["hereditary", "midnight-static"],
                outcome.Value!.ExcludedTitleIds.Order().ToList());
        }
    }

    public class EmptyDocumentsAreValid
    {
        [Fact]
        public void A_null_payload_is_an_empty_account_not_an_error()
        {
            // US1 scenario 4: a guest who never rated anything registers. That
            // is a normal outcome, and the merge over an empty account is what
            // produces the fresh account.
            var outcome = GuestStateValidator.Validate(null);

            Assert.True(outcome.IsValid);
            Assert.Empty(outcome.Value!.Interactions);
            Assert.Empty(outcome.Value.History);
            Assert.Null(outcome.Value.Preferences);
        }

        [Fact]
        public void A_document_with_no_collections_is_valid_and_means_pull_only()
        {
            // contracts/api.md: a sync body with no collections is "pull only".
            var outcome = GuestStateValidator.Validate(Document());

            Assert.True(outcome.IsValid);
            Assert.Empty(outcome.Value!.Interactions);
        }
    }

    public class UnknownStatesAreRejected
    {
        [Fact]
        public void A_state_outside_the_vocabulary_rejects_the_document()
        {
            var document = Document(new() { ["arrival"] = new("adored", ValidTimestamp) });

            var outcome = GuestStateValidator.Validate(document);

            Assert.False(outcome.IsValid);
            Assert.Contains(outcome.Errors, error => error.Contains("adored"));
        }

        [Fact]
        public void A_rejected_document_yields_no_partial_state()
        {
            // The load-bearing assertion. One good rating and one unrecognized
            // one must not produce a state containing only the good one: that
            // would drop a rating the visitor made without telling anyone.
            var document = Document(new()
            {
                ["arrival"] = new("loved", ValidTimestamp),
                ["dune-part-two"] = new("meh", ValidTimestamp),
            });

            var outcome = GuestStateValidator.Validate(document);

            Assert.False(outcome.IsValid);
            Assert.Null(outcome.Value);
        }

        [Fact]
        public void The_vocabulary_is_case_sensitive()
        {
            // 002's contract freezes the exact strings; "LOVED" is a different
            // token, and accepting it would mean the client and server disagree
            // about what is stored.
            var document = Document(new() { ["arrival"] = new("LOVED", ValidTimestamp) });

            Assert.False(GuestStateValidator.Validate(document).IsValid);
        }

        [Fact]
        public void The_errors_name_every_offending_title()
        {
            var document = Document(new()
            {
                ["arrival"] = new("adored", ValidTimestamp),
                ["get-out"] = new("loathed", ValidTimestamp),
            });

            var outcome = GuestStateValidator.Validate(document);

            Assert.Contains(outcome.Errors, error => error.Contains("arrival"));
            Assert.Contains(outcome.Errors, error => error.Contains("get-out"));
        }
    }

    /// <summary>
    /// FR-006: a removal arrives as a claim about a title with a time on it,
    /// so the server can resolve it against the account's rating by the same
    /// newest-wins rule as everything else (contracts/api.md).
    /// </summary>
    public class RemovalsAreValidated
    {
        [Fact]
        public void A_removal_becomes_a_timestamped_claim()
        {
            var outcome = GuestStateValidator.Validate(
                Document(removals: [new RemovalPayload("hereditary", ValidTimestamp)]));

            Assert.True(outcome.IsValid, string.Join("; ", outcome.Errors));
            Assert.Equal(
                new DateTimeOffset(2026, 9, 27, 10, 0, 0, TimeSpan.Zero),
                outcome.Value!.Removals["hereditary"]);
        }

        [Fact]
        public void A_document_of_only_removals_is_a_change_not_a_pull()
        {
            // The mirror of "no collections means pull only". Reading a body
            // that names only removals as an empty request would silently drop
            // an unrating, which is the failure FR-006 exists to prevent.
            var outcome = GuestStateValidator.Validate(
                Document(removals: [new RemovalPayload("hereditary", ValidTimestamp)]));

            Assert.True(outcome.IsValid);
            Assert.Single(outcome.Value!.Removals);
        }

        [Theory]
        [InlineData("not-a-date")]
        [InlineData("")]
        [InlineData(null)]
        public void A_non_parseable_removal_timestamp_rejects_the_document(string? updatedAt)
        {
            var outcome = GuestStateValidator.Validate(
                Document(
                    new() { ["arrival"] = new("loved", ValidTimestamp) },
                    removals: [new RemovalPayload("hereditary", updatedAt)]));

            // Refused whole, like every other bad field: a document accepted in
            // part would drop a rating without telling anyone.
            Assert.False(outcome.IsValid);
            Assert.Null(outcome.Value);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData(null)]
        public void An_empty_removal_title_id_is_rejected(string? titleId)
        {
            var outcome = GuestStateValidator.Validate(
                Document(removals: [new RemovalPayload(titleId, ValidTimestamp)]));

            Assert.False(outcome.IsValid);
        }

        [Fact]
        public void A_title_named_in_both_collections_rejects_the_document()
        {
            // Competing claims about one title. A body making both has already
            // lost the ordering that would settle it, so the server refuses
            // rather than picking a winner (contracts/api.md).
            var outcome = GuestStateValidator.Validate(
                Document(
                    new() { ["hereditary"] = new("disliked", ValidTimestamp) },
                    removals: [new RemovalPayload("hereditary", ValidTimestamp)]));

            Assert.False(outcome.IsValid);
            Assert.Contains("hereditary", string.Join("; ", outcome.Errors));
        }
    }

    public class MalformedFieldsAreRejected
    {
        [Fact]
        public void A_missing_state_is_rejected()
        {
            var document = Document(new() { ["arrival"] = new(null, ValidTimestamp) });

            Assert.False(GuestStateValidator.Validate(document).IsValid);
        }

        [Theory]
        [InlineData("27/09/2026")]
        [InlineData("yesterday")]
        [InlineData("2026-13-45T99:99:99Z")]
        [InlineData("")]
        public void A_non_parseable_updatedAt_is_rejected(string updatedAt)
        {
            var document = Document(new() { ["arrival"] = new("loved", updatedAt) });

            var outcome = GuestStateValidator.Validate(document);

            Assert.False(outcome.IsValid);
            Assert.Contains(outcome.Errors, error => error.Contains("arrival"));
        }

        [Theory]
        [InlineData("27/09/2026")]
        [InlineData("whenever")]
        public void A_non_parseable_chosenAt_is_rejected(string chosenAt)
        {
            var document = Document(history: [new HistoryPayload("arrival", chosenAt)]);

            Assert.False(GuestStateValidator.Validate(document).IsValid);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData(null)]
        public void An_empty_titleId_is_rejected(string? titleId)
        {
            // data-model.md: a titleId must be a non-empty string. Which string
            // is not the server's business — it does not know the catalog.
            var document = Document(history: [new HistoryPayload(titleId, ValidTimestamp)]);

            Assert.False(GuestStateValidator.Validate(document).IsValid);
        }

        [Fact]
        public void An_empty_interaction_key_is_rejected()
        {
            var document = Document(new() { [""] = new("loved", ValidTimestamp) });

            Assert.False(GuestStateValidator.Validate(document).IsValid);
        }

        [Fact]
        public void Non_parseable_preference_timestamps_are_rejected()
        {
            var document = Document(preferences: Preferences(updatedAt: "someday"));

            Assert.False(GuestStateValidator.Validate(document).IsValid);
        }

        [Fact]
        public void A_title_the_server_has_never_heard_of_is_still_legitimate()
        {
            // data-model.md: the client owns "unavailable title" rendering, so an
            // unknown id is not the server's to refuse.
            var document = Document(new() { ["a-title-from-2031"] = new("wantToWatch", ValidTimestamp) });

            Assert.True(GuestStateValidator.Validate(document).IsValid);
        }
    }
}

/// <summary>
/// Email shape checking. The point of these is what is <i>not</i> here: nothing
/// asserts a password policy, because Identity owns that rule (FR-010) and a
/// second copy would be free to drift from the enforced one.
/// </summary>
public class CredentialValidatorTests
{
    [Theory]
    [InlineData("visitor@example.com")]
    [InlineData("a.b+tag@sub.domain.co.uk")]
    [InlineData("  spaced@example.com  ")]
    public void A_well_formed_email_passes(string email)
    {
        Assert.Empty(CredentialValidator.ValidateEmail(email));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-at-sign")]
    [InlineData("@no-local-part.com")]
    [InlineData("no-domain@")]
    [InlineData("two@@example.com")]
    [InlineData("spaces in@example.com")]
    public void A_malformed_email_is_rejected(string? email)
    {
        Assert.NotEmpty(CredentialValidator.ValidateEmail(email));
    }
}

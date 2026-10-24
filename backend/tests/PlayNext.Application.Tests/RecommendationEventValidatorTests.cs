using PlayNext.Application.Contracts;
using PlayNext.Application.Validation;

namespace PlayNext.Application.Tests;

/// <summary>
/// Intake validation — the rules in data-model.md §"Verification rules enforced
/// at intake".
///
/// The whole batch is judged before anything is written (FR-009): a body with
/// one bad field stores none of its good ones. Most of these tests assert a
/// single field's boundary; the ones that matter most are the batch-level
/// checks — a duplicate id or an oversized batch — because those cannot be
/// caught by validating events one at a time.
/// </summary>
public class RecommendationEventValidatorTests
{
    private const string ValidTimestamp = "2026-10-24T18:00:00.000Z";

    private static RecommendationImpressionInput Impression(
        Guid? clientEventId = null,
        string? sessionId = "0b9e7a54-2f4d-4d0a-91c2-3b4c5d6e7f80",
        string? titleId = "tmdb:movie:27205",
        string? surface = "deck",
        int position = 1,
        string? engineVersion = "recommend-v1",
        string? catalogVersion = ValidTimestamp,
        string? filterHash = "9f2c4a1b7e3d5068",
        double score = 12.34,
        string? reasonCode = "genre-picked",
        string? shownAt = ValidTimestamp)
    {
        return new RecommendationImpressionInput(
            clientEventId ?? Guid.NewGuid(),
            sessionId,
            titleId,
            surface,
            position,
            engineVersion,
            catalogVersion,
            filterHash,
            score,
            reasonCode,
            shownAt);
    }

    private static RecommendationActionInput Action(
        Guid? clientEventId = null,
        Guid? impressionClientEventId = null,
        string? kind = "liked",
        int dwellMs = 3_240,
        string? occurredAt = ValidTimestamp)
    {
        return new RecommendationActionInput(
            clientEventId ?? Guid.NewGuid(),
            impressionClientEventId ?? Guid.NewGuid(),
            kind,
            dwellMs,
            occurredAt);
    }

    private static RecommendationEventBatch Batch(
        IReadOnlyList<RecommendationImpressionInput>? impressions = null,
        IReadOnlyList<RecommendationActionInput>? actions = null)
    {
        return new RecommendationEventBatch(impressions ?? [], actions ?? []);
    }

    public class TheHappyPath
    {
        [Fact]
        public void An_empty_batch_passes()
        {
            Assert.Empty(RecommendationEventValidator.Validate(Batch()));
        }

        [Fact]
        public void A_well_formed_batch_passes()
        {
            var impression = Impression();
            var batch = Batch([impression], [Action(impressionClientEventId: impression.ClientEventId)]);

            Assert.Empty(RecommendationEventValidator.Validate(batch));
        }

        [Theory]
        [InlineData("genre-picked")]
        [InlineData("genre-affinity")]
        [InlineData("service")]
        [InlineData("none")]
        public void Every_reason_code_is_accepted(string reasonCode)
        {
            Assert.Empty(RecommendationEventValidator.Validate(Batch([Impression(reasonCode: reasonCode)], [])));
        }

        [Theory]
        [InlineData("liked")]
        [InlineData("disliked")]
        [InlineData("skip")]
        [InlineData("watch_now")]
        [InlineData("undo")]
        public void Every_action_kind_is_accepted(string kind)
        {
            Assert.Empty(RecommendationEventValidator.Validate(Batch([], [Action(kind: kind)])));
        }

        [Theory]
        [InlineData(0)]
        [InlineData(300_000)]
        public void The_dwell_boundaries_are_inclusive(int dwellMs)
        {
            Assert.Empty(RecommendationEventValidator.Validate(Batch([], [Action(dwellMs: dwellMs)])));
        }

        [Fact]
        public void An_unknown_but_bounded_engine_version_is_accepted()
        {
            // The version identifies whichever ranker was live; the intake must
            // not have to be redeployed before a new one can report.
            Assert.Empty(RecommendationEventValidator.Validate(Batch([Impression(engineVersion: "recommend-v2")], [])));
        }
    }

    public class ImpressionRules
    {
        [Fact]
        public void An_empty_client_event_id_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(clientEventId: Guid.Empty)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].clientEventId", StringComparison.Ordinal));
        }

        [Fact]
        public void An_empty_session_id_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(sessionId: "  ")], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].sessionId", StringComparison.Ordinal));
        }

        [Fact]
        public void An_empty_title_id_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(titleId: "")], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].titleId", StringComparison.Ordinal));
        }

        [Fact]
        public void A_title_id_longer_than_64_characters_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(titleId: new string('t', 65))], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].titleId", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData(0)]
        [InlineData(-1)]
        public void A_position_below_one_is_rejected(int position)
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(position: position)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].position", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData("watchlist")]
        [InlineData("Deck")]
        [InlineData("")]
        public void An_unknown_surface_is_rejected(string surface)
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(surface: surface)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].surface", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData("yesterday")]
        [InlineData("")]
        [InlineData(null)]
        public void An_unreadable_catalog_version_is_rejected(string? catalogVersion)
        {
            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(catalogVersion: catalogVersion)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].catalogVersion", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData("tomorrow")]
        [InlineData(null)]
        public void An_unreadable_shown_at_is_rejected(string? shownAt)
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(shownAt: shownAt)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].shownAt", StringComparison.Ordinal));
        }

        [Fact]
        public void NaN_and_infinite_scores_are_rejected()
        {
            Assert.Contains(
                RecommendationEventValidator.Validate(Batch([Impression(score: double.NaN)], [])),
                error => error.StartsWith("impressions[0].score", StringComparison.Ordinal));
            Assert.Contains(
                RecommendationEventValidator.Validate(Batch([Impression(score: double.PositiveInfinity)], [])),
                error => error.StartsWith("impressions[0].score", StringComparison.Ordinal));
            Assert.Contains(
                RecommendationEventValidator.Validate(Batch([Impression(score: double.NegativeInfinity)], [])),
                error => error.StartsWith("impressions[0].score", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData("free text")]
        [InlineData("Genre-Picked")]
        [InlineData("")]
        public void A_reason_code_outside_the_vocabulary_is_rejected(string reasonCode)
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(reasonCode: reasonCode)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].reasonCode", StringComparison.Ordinal));
        }

        [Fact]
        public void An_empty_filter_hash_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(Batch([Impression(filterHash: "")], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].filterHash", StringComparison.Ordinal));
        }

        [Fact]
        public void An_engine_version_longer_than_32_characters_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(engineVersion: new string('v', 33))], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].engineVersion", StringComparison.Ordinal));
        }

        [Fact]
        public void A_session_id_longer_than_64_characters_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(sessionId: new string('s', 65))], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[0].sessionId", StringComparison.Ordinal));
        }

        [Fact]
        public void Every_bad_field_of_one_impression_is_reported_together()
        {
            // One round trip must be enough to tell a client everything that is
            // wrong with a batch: the sender is often a queue it cannot inspect.
            var errors = RecommendationEventValidator.Validate(
                Batch([new RecommendationImpressionInput(
                    Guid.Empty, "", "", "watchlist", 0, "", "never", "", double.NaN, "free", "later")], []));

            Assert.Equal(10, errors.Count);
        }
    }

    public class ActionRules
    {
        [Fact]
        public void An_empty_action_client_event_id_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(Batch([], [Action(clientEventId: Guid.Empty)]));

            Assert.Contains(errors, error => error.StartsWith("actions[0].clientEventId", StringComparison.Ordinal));
        }

        [Fact]
        public void An_empty_impression_client_event_id_is_rejected()
        {
            var errors = RecommendationEventValidator.Validate(
                Batch([], [Action(impressionClientEventId: Guid.Empty)]));

            Assert.Contains(
                errors,
                error => error.StartsWith("actions[0].impressionClientEventId", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData("loved")]
        [InlineData("Liked")]
        [InlineData("watch-now")]
        [InlineData("watchNow")]
        [InlineData("")]
        public void A_kind_outside_the_vocabulary_is_rejected(string kind)
        {
            var errors = RecommendationEventValidator.Validate(Batch([], [Action(kind: kind)]));

            Assert.Contains(errors, error => error.StartsWith("actions[0].kind", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData(-1)]
        [InlineData(300_001)]
        public void A_dwell_outside_0_to_300000_is_rejected(int dwellMs)
        {
            var errors = RecommendationEventValidator.Validate(Batch([], [Action(dwellMs: dwellMs)]));

            Assert.Contains(errors, error => error.StartsWith("actions[0].dwellMs", StringComparison.Ordinal));
        }

        [Theory]
        [InlineData("soon")]
        [InlineData(null)]
        public void An_unreadable_occurred_at_is_rejected(string? occurredAt)
        {
            var errors = RecommendationEventValidator.Validate(Batch([], [Action(occurredAt: occurredAt)]));

            Assert.Contains(errors, error => error.StartsWith("actions[0].occurredAt", StringComparison.Ordinal));
        }
    }

    public class BatchRules
    {
        [Fact]
        public void A_duplicate_client_event_id_across_the_two_arrays_is_rejected()
        {
            var shared = Guid.NewGuid();

            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(clientEventId: shared)], [Action(clientEventId: shared)]));

            Assert.Contains(errors, error => error.Contains("clientEventId", StringComparison.Ordinal)
                && error.Contains("duplicate", StringComparison.OrdinalIgnoreCase));
        }

        [Fact]
        public void A_duplicate_client_event_id_within_impressions_is_rejected()
        {
            var shared = Guid.NewGuid();

            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(clientEventId: shared), Impression(clientEventId: shared)], []));

            Assert.Contains(errors, error => error.StartsWith("impressions[1].clientEventId", StringComparison.Ordinal));
        }

        [Fact]
        public void Exactly_100_impressions_and_200_actions_are_accepted()
        {
            var impressions = Enumerable.Range(0, 100).Select(_ => Impression()).ToArray();
            var actions = Enumerable.Range(0, 200).Select(_ => Action()).ToArray();

            Assert.Empty(RecommendationEventValidator.Validate(Batch(impressions, actions)));
        }

        [Fact]
        public void More_than_100_impressions_are_rejected()
        {
            var impressions = Enumerable.Range(0, 101).Select(_ => Impression()).ToArray();

            Assert.NotEmpty(RecommendationEventValidator.Validate(Batch(impressions, [])));
        }

        [Fact]
        public void More_than_200_actions_are_rejected()
        {
            var actions = Enumerable.Range(0, 201).Select(_ => Action()).ToArray();

            Assert.NotEmpty(RecommendationEventValidator.Validate(Batch([], actions)));
        }

        [Fact]
        public void More_than_ten_failures_yields_exactly_ten_errors()
        {
            // The cap keeps a hostile or broken client from turning the error
            // response into an echo of its own payload.
            var impressions = Enumerable.Range(0, 12).Select(_ => Impression(position: 0)).ToArray();

            Assert.Equal(10, RecommendationEventValidator.Validate(Batch(impressions, [])).Count);
        }

        [Fact]
        public void An_error_never_echoes_the_submitted_value()
        {
            const string Hostile = "<script>alert('x')</script>";

            var errors = RecommendationEventValidator.Validate(
                Batch([Impression(reasonCode: Hostile)], []));

            Assert.NotEmpty(errors);
            Assert.DoesNotContain(errors, error => error.Contains("script", StringComparison.OrdinalIgnoreCase));
        }
    }
}

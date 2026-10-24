using System.Globalization;
using PlayNext.Application.Contracts;
using PlayNext.Domain;

namespace PlayNext.Application.Validation;

/// <summary>
/// Judges a whole intake batch before anything is written (FR-009,
/// data-model.md §"Verification rules enforced at intake").
///
/// Every problem is collected before returning, and the list is capped at ten:
/// the sender is a queue the visitor cannot inspect, so one round trip should
/// reveal enough to fix it; and an uncapped list would turn a hostile body into
/// an echo of itself.
///
/// Error strings name the field and the rule and never repeat the submitted
/// value. That is a privacy rule, not a formatting preference: the fields that
/// reach the validator are exactly the ones a client could fill with text, and
/// echoing them back would make the endpoint a reflector.
/// </summary>
public static class RecommendationEventValidator
{
    /// <summary>The per-request impression ceiling (contracts/recommendation-events.md).</summary>
    public const int MaxImpressions = 100;

    /// <summary>The per-request action ceiling.</summary>
    public const int MaxActions = 200;

    /// <summary>The number of errors returned at most.</summary>
    public const int MaxErrors = 10;

    /// <summary>The only surface today.</summary>
    public const string DeckSurface = "deck";

    /// <summary>
    /// Returns the field-level errors in the batch, or an empty list when the
    /// whole batch is acceptable. Ordered by array, then by element, then by
    /// the field order in the contract, so a client sees failures in the order
    /// it would read its own payload.
    /// </summary>
    public static IReadOnlyList<string> Validate(RecommendationEventBatch batch)
    {
        var impressions = batch.Impressions ?? [];
        var actions = batch.Actions ?? [];

        // Oversized batches are not inspected further: the ceiling exists so a
        // hostile body cannot make the server do unbounded validation work.
        var errors = new List<string>();
        if (impressions.Count > MaxImpressions)
        {
            errors.Add($"At most {MaxImpressions} impressions are allowed per request.");
        }

        if (actions.Count > MaxActions)
        {
            errors.Add($"At most {MaxActions} actions are allowed per request.");
        }

        if (errors.Count > 0)
        {
            return errors;
        }

        var seen = new HashSet<Guid>();

        for (var i = 0; i < impressions.Count && errors.Count < MaxErrors; i++)
        {
            ValidateImpression(impressions[i], i, seen, errors);
        }

        for (var i = 0; i < actions.Count && errors.Count < MaxErrors; i++)
        {
            ValidateAction(actions[i], i, seen, errors);
        }

        return errors.Count <= MaxErrors ? errors : errors[..MaxErrors];
    }

    /// <summary>
    /// Parses an RFC 3339 timestamp, assuming UTC when the string carries no
    /// offset.
    ///
    /// Shared with the store so the rule that decided a value was acceptable is
    /// the rule that reads it back. Without
    /// <see cref="DateTimeStyles.AssumeUniversal"/>, a bare
    /// <c>2026-10-24T18:00:00</c> would be read as the server's local time, and
    /// the same event would land at a different instant depending on where the
    /// API runs (constitution VI).
    /// </summary>
    public static bool TryParseTimestamp(string? text, out DateTimeOffset value)
    {
        return DateTimeOffset.TryParse(
            text,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out value);
    }

    private static void ValidateImpression(
        RecommendationImpressionInput impression,
        int index,
        HashSet<Guid> seen,
        List<string> errors)
    {
        var path = $"impressions[{index}]";

        ValidateClientEventId(impression.ClientEventId, path, seen, errors);
        ValidateId(impression.SessionId, 64, $"{path}.sessionId", errors);
        ValidateId(impression.TitleId, 64, $"{path}.titleId", errors);

        if (!string.Equals(impression.Surface, DeckSurface, StringComparison.Ordinal))
        {
            errors.Add($"{path}.surface must be a known surface.");
        }

        if (impression.Position < 1)
        {
            errors.Add($"{path}.position must be at least 1.");
        }

        ValidateId(impression.EngineVersion, 32, $"{path}.engineVersion", errors);

        if (!TryParseTimestamp(impression.CatalogVersion, out _))
        {
            errors.Add($"{path}.catalogVersion must be an RFC 3339 timestamp.");
        }

        ValidateId(impression.FilterHash, 32, $"{path}.filterHash", errors);

        if (!double.IsFinite(impression.Score))
        {
            errors.Add($"{path}.score must be a finite number.");
        }

        if (!RecommendationReasonCodes.IsKnown(impression.ReasonCode))
        {
            errors.Add($"{path}.reasonCode is not a recommendation reason.");
        }

        if (!TryParseTimestamp(impression.ShownAt, out _))
        {
            errors.Add($"{path}.shownAt must be an RFC 3339 timestamp.");
        }
    }

    private static void ValidateAction(
        RecommendationActionInput action,
        int index,
        HashSet<Guid> seen,
        List<string> errors)
    {
        var path = $"actions[{index}]";

        ValidateClientEventId(action.ClientEventId, path, seen, errors);

        if (action.ImpressionClientEventId == Guid.Empty)
        {
            errors.Add($"{path}.impressionClientEventId is required.");
        }

        if (!RecommendationActionKinds.IsKnown(action.Kind))
        {
            errors.Add($"{path}.kind is not a recommendation action.");
        }

        if (action.DwellMs is < 0 or > 300_000)
        {
            errors.Add($"{path}.dwellMs must be between 0 and 300000.");
        }

        if (!TryParseTimestamp(action.OccurredAt, out _))
        {
            errors.Add($"{path}.occurredAt must be an RFC 3339 timestamp.");
        }
    }

    /// <summary>
    /// Checks presence and uniqueness in one place: an id that is absent cannot
    /// also be a duplicate, so reporting both would be noise.
    /// </summary>
    private static void ValidateClientEventId(Guid id, string path, HashSet<Guid> seen, List<string> errors)
    {
        if (id == Guid.Empty)
        {
            errors.Add($"{path}.clientEventId is required.");
        }
        else if (!seen.Add(id))
        {
            errors.Add($"{path}.clientEventId duplicates another event in the batch.");
        }
    }

    private static void ValidateId(string? value, int maxLength, string path, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            errors.Add($"{path} is required.");
        }
        else if (value.Length > maxLength)
        {
            errors.Add($"{path} must be at most {maxLength} characters.");
        }
    }
}

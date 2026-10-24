namespace PlayNext.Application.Contracts;

/// <summary>
/// One intake request: everything a client flush can carry (contracts/
/// recommendation-events.md).
///
/// Timestamps arrive as strings rather than <see cref="DateTimeOffset"/> so a
/// malformed value is reported as a field-level validation error — naming the
/// field and the rule — instead of surfacing as a framework deserialization
/// failure the client cannot act on. They are parsed once, with the same
/// invariant-culture rule, by
/// <see cref="Validation.RecommendationEventValidator.TryParseTimestamp"/>.
/// </summary>
public sealed record RecommendationEventBatch(
    IReadOnlyList<RecommendationImpressionInput>? Impressions,
    IReadOnlyList<RecommendationActionInput>? Actions);

/// <summary>One displayed card.</summary>
public sealed record RecommendationImpressionInput(
    Guid ClientEventId,
    string? SessionId,
    string? TitleId,
    string? Surface,
    int Position,
    string? EngineVersion,
    string? CatalogVersion,
    string? FilterHash,
    double Score,
    string? ReasonCode,
    string? ShownAt);

/// <summary>One visitor response to a displayed card.</summary>
public sealed record RecommendationActionInput(
    Guid ClientEventId,
    Guid ImpressionClientEventId,
    string? Kind,
    int DwellMs,
    string? OccurredAt);

/// <summary>
/// What a batch actually stored. <see cref="AcceptedImpressions"/> and
/// <see cref="AcceptedActions"/> count inserts made by *this* request;
/// <see cref="Duplicates"/> counts events already stored under the same
/// <c>clientEventId</c>; <see cref="Unlinked"/> counts actions whose impression
/// was neither in the batch nor stored.
/// </summary>
public sealed record RecommendationEventOutcome(
    int AcceptedImpressions,
    int AcceptedActions,
    int Duplicates,
    int Unlinked)
{
    /// <summary>The no-op outcome: an empty or fully duplicate batch.</summary>
    public static readonly RecommendationEventOutcome Empty = new(0, 0, 0, 0);
}

/// <summary>How the intake ended, before the endpoint turns it into a status code.</summary>
public enum RecommendationIntakeStatus
{
    /// <summary>Validated, admitted and stored (or nothing to store).</summary>
    Accepted,

    /// <summary>The validator refused the batch; <see cref="RecommendationIntakeResult.Errors"/> says why.</summary>
    Invalid,

    /// <summary>The session's window is full; <see cref="RecommendationIntakeResult.RetryAfterSeconds"/> says for how long.</summary>
    RateLimited,
}

/// <summary>
/// The outcome of one intake, as the use case sees it (009, T028).
///
/// Three outcomes, not an exception hierarchy: every one of them is an expected
/// answer on a fire-and-forget endpoint, and a client does not distinguish a
/// thrown validation failure from a returned one — but the endpoint must, to
/// answer 400, 429 or 202.
/// </summary>
public sealed record RecommendationIntakeResult(
    RecommendationIntakeStatus Status,
    RecommendationEventOutcome Outcome,
    IReadOnlyList<string> Errors,
    int RetryAfterSeconds)
{
    public static RecommendationIntakeResult Accepted(RecommendationEventOutcome outcome) =>
        new(RecommendationIntakeStatus.Accepted, outcome, [], 0);

    public static RecommendationIntakeResult Invalid(IReadOnlyList<string> errors) =>
        new(RecommendationIntakeStatus.Invalid, RecommendationEventOutcome.Empty, errors, 0);

    public static RecommendationIntakeResult RateLimited(int retryAfterSeconds) =>
        new(
            RecommendationIntakeStatus.RateLimited,
            RecommendationEventOutcome.Empty,
            [],
            retryAfterSeconds);
}

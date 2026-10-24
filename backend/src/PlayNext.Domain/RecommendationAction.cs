namespace PlayNext.Domain;

/// <summary>
/// One visitor response to a displayed card (FR-004, FR-005).
///
/// An undo is a row of its own against the same impression; the action it
/// reverses is never deleted or edited. That is what makes the record a log
/// rather than a current-state document: the visitor's change of mind is
/// observable, and so is the fact that they made one.
/// </summary>
public sealed class RecommendationAction
{
    /// <summary>The server-assigned key.</summary>
    public long Id { get; set; }

    /// <summary>The client-generated idempotency key, unique across retries.</summary>
    public Guid ClientEventId { get; set; }

    /// <summary>The impression this action answers.</summary>
    public long ImpressionId { get; set; }

    /// <summary>The impression this action answers.</summary>
    public RecommendationImpression Impression { get; set; } = null!;

    /// <summary>One of <see cref="RecommendationActionKinds.All"/>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Time from the impression being shown to this action, capped at five
    /// minutes. Stored in milliseconds so the client's measurement is not
    /// rounded twice.
    /// </summary>
    public int DwellMs { get; set; }

    /// <summary>The client's clock when the action occurred.</summary>
    public DateTimeOffset OccurredAt { get; set; }

    /// <summary>The server's clock when the event was stored.</summary>
    public DateTimeOffset ReceivedAt { get; set; }
}

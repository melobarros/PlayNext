namespace PlayNext.Domain;

/// <summary>
/// One recommendation card displayed in one session (FR-001).
///
/// An append-only observation, not account state: it references the title and
/// the account by value, never by foreign key, so a catalog purge or a future
/// account deletion cannot silently take the record with it. The reason the
/// deck gave, the score it computed, and the context it ranked under are all
/// captured here because none of them can be reconstructed later — the ranker
/// moves on, and a replay needs the version that was actually live.
/// </summary>
public sealed class RecommendationImpression
{
    /// <summary>The server-assigned key, used to link actions.</summary>
    public long Id { get; set; }

    /// <summary>
    /// The client-generated idempotency key. Unique, so a retried batch inserts
    /// nothing the second time (FR-008).
    /// </summary>
    public Guid ClientEventId { get; set; }

    /// <summary>The random per-tab anonymous session id (FR-002).</summary>
    public string SessionId { get; set; } = string.Empty;

    /// <summary>The account, when the visitor was signed in; otherwise null.</summary>
    public Guid? UserId { get; set; }

    /// <summary>The catalog title id, kept even if the title is later removed (FR-023).</summary>
    public string TitleId { get; set; } = string.Empty;

    /// <summary>Where the card was displayed. `deck` is the only surface today.</summary>
    public string Surface { get; set; } = string.Empty;

    /// <summary>The card's one-based position in the deck at display time.</summary>
    public int Position { get; set; }

    /// <summary>The ranking implementation, e.g. `recommend-v1`.</summary>
    public string EngineVersion { get; set; } = string.Empty;

    /// <summary>The catalog snapshot's `fetchedAt`, identifying the catalog ranked from.</summary>
    public DateTimeOffset CatalogVersion { get; set; }

    /// <summary>The FNV-1a digest of the normalized filters, without exposing them.</summary>
    public string FilterHash { get; set; } = string.Empty;

    /// <summary>The ranker's within-tier score for this title.</summary>
    public double Score { get; set; }

    /// <summary>The closed reason code, e.g. `genre-picked`.</summary>
    public string ReasonCode { get; set; } = string.Empty;

    /// <summary>The client's clock when the card became current.</summary>
    public DateTimeOffset ShownAt { get; set; }

    /// <summary>The server's clock when the event was stored; the replay and purge order by this.</summary>
    public DateTimeOffset ReceivedAt { get; set; }

    /// <summary>The responses recorded against this impression.</summary>
    public List<RecommendationAction> Actions { get; } = [];
}

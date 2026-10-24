namespace PlayNext.Domain;

/// <summary>
/// The recommendation-event action vocabulary (FR-004).
///
/// These five wire names are the contract between the deck and the intake.
/// They are deliberately not <see cref="InteractionState"/> values: a skip and
/// an undo are things a visitor did to a card, not ratings the deck stores, and
/// `watchingNow` is the interaction state a `watch_now` action produces. Keeping
/// the two vocabularies separate is what stops an event from being mistaken for
/// account state.
///
/// The names are stored verbatim, so they are a contract: renaming one makes
/// every existing event unreadable as the kind it describes.
/// </summary>
public static class RecommendationActionKinds
{
    /// <summary>The visitor rated the card positively.</summary>
    public const string Liked = "liked";

    /// <summary>The visitor rated the card negatively.</summary>
    public const string Disliked = "disliked";

    /// <summary>The visitor advanced without a verdict.</summary>
    public const string Skip = "skip";

    /// <summary>The visitor stopped the loop and chose to watch the title.</summary>
    public const string WatchNow = "watch_now";

    /// <summary>The visitor reversed the last rating; the reversed action is kept.</summary>
    public const string Undo = "undo";

    /// <summary>Every kind, in the vocabulary's declared order.</summary>
    public static readonly IReadOnlyList<string> All = [Liked, Disliked, Skip, WatchNow, Undo];

    /// <summary>
    /// Whether a wire value is in the vocabulary. Case-sensitive on purpose: the
    /// stored column must read as exactly one of these five, and accepting
    /// `Liked` would create a second spelling for the same kind.
    /// </summary>
    public static bool IsKnown(string? kind) =>
        kind is not null && All.Contains(kind, StringComparer.Ordinal);
}

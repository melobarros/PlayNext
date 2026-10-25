namespace PlayNext.Domain;

/// <summary>
/// The closed set of reasons the ranker can give for a card (FR-001, research
/// D6).
///
/// The ranker's human-readable <c>reason</c> is prose that may be reworded at
/// any time; the code is what the record stores, so an analysis over months
/// still compares like with like. It is a vocabulary rather than free text for
/// the same reason the action kinds are (FR-020): a text field would be a place
/// to smuggle a name into the log.
/// </summary>
public static class RecommendationReasonCodes
{
    /// <summary>A genre the visitor picked in the quiz.</summary>
    public const string GenrePicked = "genre-picked";

    /// <summary>A genre inferred from the visitor's ratings.</summary>
    public const string GenreAffinity = "genre-affinity";

    /// <summary>A release era inferred from the visitor's ratings (added by 010).</summary>
    public const string EraAffinity = "era-affinity";

    /// <summary>Available on a service the visitor chose.</summary>
    public const string Service = "service";

    /// <summary>No specific reason — the title is in the general pool.</summary>
    public const string None = "none";

    /// <summary>Every code, in the order the ranker's branches are evaluated.</summary>
    public static readonly IReadOnlyList<string> All =
        [GenrePicked, GenreAffinity, EraAffinity, Service, None];

    /// <summary>Whether <paramref name="code"/> is in the vocabulary.</summary>
    public static bool IsKnown(string? code) =>
        code is not null && All.Contains(code, StringComparer.Ordinal);
}

using PlayNext.Domain;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The account copy of one rating — 002's <c>InteractionRecord</c>, server-side.
///
/// The primary key is <c>(UserId, TitleId)</c>, which is what makes "one rating
/// per title" structural rather than a rule the application has to remember: the
/// database itself refuses a second row for the same title. It is also exactly
/// the index the constitution's performance standard names, so per-title upserts
/// are a single index seek and no second index is created.
/// </summary>
public class UserInteraction
{
    public Guid UserId { get; set; }

    public ApplicationUser? User { get; set; }

    /// <summary>The catalog id — the mock catalog's today, TMDB's in Milestone 2.</summary>
    public string TitleId { get; set; } = string.Empty;

    /// <summary>One of the six vocabulary values.</summary>
    public InteractionState State { get; set; }

    /// <summary>Device-written. The newest-wins comparator of the merge (research D4).</summary>
    public DateTimeOffset UpdatedAt { get; set; }
}

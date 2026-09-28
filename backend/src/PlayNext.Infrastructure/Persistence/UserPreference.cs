using PlayNext.Domain;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The account copy of 001's completed <c>QuizState</c> — one row per user, so
/// the primary key is the user id and there is no separate id column.
///
/// Only the <i>completed</i> quiz is stored. An in-progress quiz stays on the
/// device: the deck and the quiz both act on completed preferences only, so
/// migrating half-answered questions would move state nothing reads.
///
/// The three dimension choices are jsonb rather than child tables because the
/// 001 contract freezes them as a document shape and no query ever filters on
/// their members — normalizing them would buy nothing and cost a join.
/// </summary>
public class UserPreference
{
    public Guid UserId { get; set; }

    public ApplicationUser? User { get; set; }

    public DimensionChoice MediaType { get; set; } = DimensionChoice.NoPreference;

    public DimensionChoice Genre { get; set; } = DimensionChoice.NoPreference;

    public DimensionChoice Provider { get; set; } = DimensionChoice.NoPreference;

    public bool IncludeUnownedProviders { get; set; }

    public DateTimeOffset CompletedAt { get; set; }

    /// <summary>The newest-wins comparator. The document is taken whole, never field-merged.</summary>
    public DateTimeOffset UpdatedAt { get; set; }
}

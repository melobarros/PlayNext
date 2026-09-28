namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// One entry in the watching log — 002/003's <c>WatchHistoryEntry</c>,
/// server-side.
///
/// Its own table rather than a collection on the user because it grows
/// independently and is read in full for the History surface; the interaction
/// rows are bounded by the catalog, this one is not.
///
/// An entry is the pair <c>(UserId, TitleId, ChosenAt)</c> and that triple is
/// unique. That is the whole of the retry story: a migration that fails after
/// writing history and is then replayed inserts nothing the second time, so
/// replay is idempotent at the database level rather than by application
/// bookkeeping (research D4, FR-007).
/// </summary>
public class UserWatchHistoryEntry
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public ApplicationUser? User { get; set; }

    public string TitleId { get; set; } = string.Empty;

    /// <summary>Device-written: when the visitor actually chose to watch it.</summary>
    public DateTimeOffset ChosenAt { get; set; }
}

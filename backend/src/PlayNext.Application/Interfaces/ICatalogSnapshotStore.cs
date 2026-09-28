using PlayNext.Application.Contracts;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// Where the last good snapshot for a region is kept (research D10).
///
/// The port hides the two levels — a memory cache in front of a durable row —
/// because that split is an implementation detail the use case should not be
/// able to depend on. What the use case relies on is the guarantee the store
/// owes it: <see cref="SaveAsync"/> is called only with a complete snapshot,
/// and a snapshot that was never saved is never returned.
///
/// <b>And a snapshot the provider's terms no longer allow us to keep is never
/// returned either</b> — it is treated as absent, and the row is purged. That
/// is deliberately the store's job rather than the caller's: a ceiling enforced
/// by each caller is a ceiling that holds until someone adds a caller. See
/// <c>TmdbOptions.MaxCacheAge</c> for the value and why it is a day count.
/// </summary>
public interface ICatalogSnapshotStore
{
    /// <summary>
    /// The stored snapshot for a region, or <c>null</c> when none has ever been
    /// retrieved. Never throws for "absent" — absence is an ordinary answer
    /// with its own path (FR-014).
    /// </summary>
    Task<CatalogSnapshot?> LoadAsync(string region, CancellationToken cancellationToken);

    /// <summary>
    /// Replaces the region's snapshot with a complete one.
    ///
    /// Called only after a batch has succeeded in full, so what is stored is
    /// never a mixture of a good fetch and a failed one (FR-013).
    /// </summary>
    Task SaveAsync(CatalogSnapshot snapshot, CancellationToken cancellationToken);
}

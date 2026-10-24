using PlayNext.Application.Contracts;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The versioned catalog's storage (feature 008, research D1/D4).
///
/// A build is invisible until <see cref="PromoteAsync"/> flips its version to
/// <c>Active</c> in one transaction, and readers pin one version id for every
/// query, so no visitor ever sees a half-built catalog or a mixture of two.
/// </summary>
public interface ICatalogVersionStore
{
    /// <summary>The region's single active version, or <c>null</c> when none has been promoted.</summary>
    Task<CatalogVersionRef?> FindActiveAsync(string region, CancellationToken cancellationToken);

    /// <summary>
    /// Begins or resumes a building version for <paramref name="fetchTime"/>.
    ///
    /// Idempotent and resumable (research D6): the same source timestamp reuses
    /// the same building version, a newer one discards a stale building version,
    /// and an already-promoted version with the same timestamp is reported as
    /// such rather than rebuilt.
    /// </summary>
    Task<CatalogBuildStart> BeginBuildAsync(
        string region,
        DateTimeOffset fetchTime,
        CatalogVersionSource source,
        CancellationToken cancellationToken);

    /// <summary>
    /// Replaces a building version's rows with a complete composition, in the
    /// build's own array order.
    /// </summary>
    Task WriteAsync(Guid versionId, CatalogBuild build, CancellationToken cancellationToken);

    /// <summary>
    /// <c>Building → Active</c> and the previous <c>Active → Superseded</c> in
    /// one transaction. When the general slice succeeded, the rollback snapshot
    /// is written in the same transaction (FR-029).
    /// </summary>
    Task PromoteAsync(
        Guid versionId,
        CatalogSnapshot? rollbackSnapshot,
        DateTimeOffset completedAt,
        CancellationToken cancellationToken);

    /// <summary>Deletes a building version that will never be promoted.</summary>
    Task DeleteAsync(Guid versionId, CancellationToken cancellationToken);

    /// <summary>A version's rows, for carrying a failed slice's last-known-good data.</summary>
    Task<IReadOnlyList<CatalogTitleRow>> LoadRowsAsync(Guid versionId, CancellationToken cancellationToken);

    /// <summary>
    /// Deletes stale building versions, old superseded versions, and returns how
    /// many versions were removed.
    /// </summary>
    Task<int> CleanupAsync(
        DateTimeOffset now,
        TimeSpan buildingMaxAge,
        TimeSpan supersededMaxAge,
        CancellationToken cancellationToken);
}

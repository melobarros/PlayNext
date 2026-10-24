namespace PlayNext.Domain;

/// <summary>
/// The retention rules (research D5, data-model "Retention lifecycle").
///
/// The provider's terms cap how long carriage data may be kept; six months is
/// the operating ceiling, so every catalog row carries its own observation time
/// and a row older than the cutoff is not served. The rules are pure so the
/// cutoff and the archive decision can be settled without a database.
/// </summary>
public static class CatalogRetention
{
    /// <summary>The ceiling: six months from observation to deletion.</summary>
    public static readonly TimeSpan Limit = TimeSpan.FromDays(180);

    /// <summary>The oldest observation that may still be served at <paramref name="now"/>.</summary>
    public static DateTimeOffset Cutoff(DateTimeOffset now) => now - Limit;

    /// <summary>Whether one row observed at <paramref name="observedAt"/> has aged out.</summary>
    public static bool IsExpired(DateTimeOffset observedAt, DateTimeOffset now) => observedAt < Cutoff(now);

    /// <summary>
    /// Whether a version is too old to serve. A version with no observation at
    /// all is treated as expired: there is nothing in it that can be proven
    /// recent.
    /// </summary>
    public static bool IsVersionExpired(DateTimeOffset? latestObservedAt, DateTimeOffset now) =>
        latestObservedAt is null || latestObservedAt < Cutoff(now);

    /// <summary>
    /// Whether a title leaving the catalog must be archived. Only a title a
    /// visitor's own record still references needs to remain readable; an
    /// unreferenced title is simply gone.
    /// </summary>
    public static bool ShouldArchive(bool referencedByUserRecord) => referencedByUserRecord;

    /// <summary>
    /// A version's <c>LatestObservedAt</c>: the newest row observation, or
    /// <c>null</c> when the version has no rows left. Recomputed after a purge,
    /// which can leave an old version with nothing current.
    /// </summary>
    public static DateTimeOffset? LatestObservedAt(IEnumerable<DateTimeOffset> observedAt)
    {
        DateTimeOffset? latest = null;

        foreach (var observed in observedAt)
        {
            if (latest is null || observed > latest)
            {
                latest = observed;
            }
        }

        return latest;
    }
}

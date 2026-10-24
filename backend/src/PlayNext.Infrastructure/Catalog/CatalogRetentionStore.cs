using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The retention purge (FR-015/016, research D5).
///
/// The provider's terms put a ceiling on keeping its data, so a row observed
/// longer than <see cref="CatalogRetention.Limit"/> ago is deleted — but a
/// title a visitor's own record still points at must remain resolvable, or a
/// rating would outlive the thing it rates. Those referenced titles are copied
/// to <c>CatalogRetiredTitles</c> <b>without availability</b>; an unreferenced
/// title is simply gone.
///
/// The archive is not a second catalog: it carries only what the watchlist and
/// history need to render a row, and a row is removed the first purge after the
/// last user record that references it disappears.
/// </summary>
public sealed class CatalogRetentionStore(AppDbContext db) : ICatalogRetentionStore
{
    /// <inheritdoc />
    public async Task<CatalogRetentionOutcome> PurgeAsync(
        string region,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var cutoff = CatalogRetention.Cutoff(now);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var version = await db.CatalogVersions
            .FirstOrDefaultAsync(
                row => row.Region == region && row.State == CatalogVersionStates.Active,
                cancellationToken);

        var deletedTitles = 0;
        var archivedTitles = 0;

        if (version is not null)
        {
            var expired = await db.CatalogTitles
                .Where(title => title.VersionId == version.Id && title.LastObservedAt < cutoff)
                .Include(title => title.Genres)
                .Include(title => title.Availability)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

            if (expired.Count > 0)
            {
                archivedTitles = await ArchiveReferencedAsync(expired, now, cancellationToken);

                db.CatalogTitles.RemoveRange(expired);
                await db.SaveChangesAsync(cancellationToken);

                deletedTitles = expired.Count;
            }

            // A purge can leave a version with nothing current. The gate that
            // decides whether the version may be served reads this value, so it
            // is recomputed in the same transaction as the deletion.
            version.LatestObservedAt = await db.CatalogTitles
                .Where(title => title.VersionId == version.Id)
                .MaxAsync(title => (DateTimeOffset?)title.LastObservedAt, cancellationToken);

            await db.SaveChangesAsync(cancellationToken);
        }

        // A referenced archive row stays; once the last user record that pointed
        // at it is gone, the next purge removes it.
        var deletedArchiveRows = await db.CatalogRetiredTitles
            .Where(row => !db.Interactions.Any(interaction => interaction.TitleId == row.TitleId)
                && !db.WatchHistory.Any(entry => entry.TitleId == row.TitleId))
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return new CatalogRetentionOutcome(deletedTitles, archivedTitles, deletedArchiveRows);
    }

    /// <summary>
    /// Copies every expired title a user record still references into the
    /// archive, keyed by title id and refreshed whole. Returns how many titles
    /// were archived.
    /// </summary>
    private async Task<int> ArchiveReferencedAsync(
        IReadOnlyList<CatalogTitleRecord> expired,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var ids = expired
            .Select(record => record.TitleId)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var interacted = await db.Interactions
            .Where(interaction => ids.Contains(interaction.TitleId))
            .Select(interaction => interaction.TitleId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var watched = await db.WatchHistory
            .Where(entry => ids.Contains(entry.TitleId))
            .Select(entry => entry.TitleId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var referenced = interacted
            .Concat(watched)
            .ToHashSet(StringComparer.Ordinal);

        if (referenced.Count == 0)
        {
            return 0;
        }

        var toArchive = expired
            .Where(record => referenced.Contains(record.TitleId))
            .OrderByDescending(record => record.LastObservedAt)
            .GroupBy(record => record.TitleId, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

        var existing = await db.CatalogRetiredTitles
            .Where(row => referenced.Contains(row.TitleId))
            .ToDictionaryAsync(row => row.TitleId, StringComparer.Ordinal, cancellationToken);

        foreach (var record in toArchive)
        {
            // The archive copy keeps the wire title and nothing else. The
            // serializer strips availability inside the type, so a caller cannot
            // accidentally carry provider carriage data past the ceiling.
            var payload = CatalogTitleJson.Serialize(ToTitle(record));

            if (existing.TryGetValue(record.TitleId, out var row))
            {
                row.PayloadJson = payload;
                row.LastObservedAt = record.LastObservedAt;
                row.RetiredAt = now;

                continue;
            }

            db.CatalogRetiredTitles.Add(new CatalogRetiredTitle
            {
                TitleId = record.TitleId,
                PayloadJson = payload,
                LastObservedAt = record.LastObservedAt,
                RetiredAt = now,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        return toArchive.Count;
    }

    private static CatalogTitle ToTitle(CatalogTitleRecord record) => new(
        record.TitleId,
        record.Name,
        record.ReleaseYear,
        CatalogMediaTypes.FromWire(record.MediaType) ?? CatalogMediaType.Movie,
        record.Genres
            .OrderBy(genre => genre.Position)
            .Select(genre => genre.GenreId)
            .ToList(),
        record.Synopsis,
        record.Rating,
        record.VoteCount,
        record.RuntimeMinutes,
        record.TrailerUrl,
        record.PosterUrl,
        record.Availability
            .OrderBy(entry => entry.Position)
            .Select(entry => new StreamingAvailability(entry.ServiceId, entry.DeepLinkUrl))
            .ToList());
}

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

// The value a reader sees and the row a writer stores share a name and are not
// interchangeable (the same split CatalogSnapshotStore documents).
using CatalogSnapshot = PlayNext.Application.Contracts.CatalogSnapshot;
using StoredSnapshot = PlayNext.Infrastructure.Persistence.CatalogSnapshot;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The versioned catalog's storage (data-model §4–§7, research D1/D6).
///
/// Two properties carry the whole design:
/// <list type="bullet">
///   <item><b>A build is invisible until promotion.</b> Rows are written under
///   a <c>Building</c> version, and readers pin the <c>Active</c> one, so a
///   half-written catalog is unreachable rather than merely unadvertised.</item>
///   <item><b>Promotion is one transaction.</b> The previous active version is
///   superseded, the building version becomes active, and the rollback snapshot
///   is rewritten — all or nothing, so no request can observe two active
///   versions or an active version whose snapshot is a version behind.</item>
/// </list>
///
/// The store is scoped: it writes through the request's (or the background
/// run's) <see cref="AppDbContext"/>. The cache it evicts on promotion is
/// process-wide, which is why it is injected rather than owned.
/// </summary>
public sealed class CatalogVersionStore(AppDbContext db, IMemoryCache cache, TimeProvider time)
    : ICatalogVersionStore
{
    /// <inheritdoc />
    public async Task<CatalogVersionRef?> FindActiveAsync(string region, CancellationToken cancellationToken)
    {
        return await db.CatalogVersions
            .AsNoTracking()
            .Where(version => version.Region == region && version.State == CatalogVersionStates.Active)
            .Select(version => new CatalogVersionRef(
                version.Id,
                version.Region,
                version.FetchedAt,
                version.LatestObservedAt))
            .SingleOrDefaultAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<CatalogBuildStart> BeginBuildAsync(
        string region,
        DateTimeOffset fetchTime,
        CatalogVersionSource source,
        CancellationToken cancellationToken)
    {
        var active = await db.CatalogVersions
            .AsNoTracking()
            .Where(version => version.Region == region && version.State == CatalogVersionStates.Active)
            .Select(version => new { version.Id, version.FetchedAt })
            .FirstOrDefaultAsync(cancellationToken);

        // The same source timestamp is already serving: the migration is
        // idempotent, and rerunning it is a no-op rather than a rebuild
        // (research D6).
        if (active is not null && active.FetchedAt == fetchTime)
        {
            return new CatalogBuildStart(active.Id, AlreadyPromoted: true, Outdated: false);
        }

        var building = await db.CatalogVersions
            .Where(version => version.Region == region && version.State == CatalogVersionStates.Building)
            .FirstOrDefaultAsync(cancellationToken);

        if (building is not null)
        {
            // A newer build already owns the region. This request is older data
            // and must not replace it.
            if (building.FetchedAt > fetchTime)
            {
                return new CatalogBuildStart(building.Id, AlreadyPromoted: false, Outdated: true);
            }

            if (building.FetchedAt < fetchTime)
            {
                // A newer snapshot invalidates the stale build. Deleting it (and
                // its rows, by cascade) is what lets the partial unique index
                // accept the replacement.
                db.CatalogVersions.Remove(building);
                await db.SaveChangesAsync(cancellationToken);
                building = null;
            }
        }

        building ??= new CatalogVersion
        {
            Id = Guid.NewGuid(),
            Region = region,
            State = CatalogVersionStates.Building,
            Source = source == CatalogVersionSource.Migration
                ? CatalogVersionSources.Migration
                : CatalogVersionSources.Refresh,
            CreatedAt = time.GetUtcNow(),
            FetchedAt = fetchTime,
        };

        if (db.Entry(building).State == EntityState.Detached)
        {
            db.CatalogVersions.Add(building);
            await db.SaveChangesAsync(cancellationToken);
        }

        return new CatalogBuildStart(building.Id, AlreadyPromoted: false, Outdated: false);
    }

    /// <inheritdoc />
    public async Task WriteAsync(Guid versionId, CatalogBuild build, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var version = await db.CatalogVersions
            .FirstOrDefaultAsync(row => row.Id == versionId, cancellationToken)
            ?? throw new InvalidOperationException("The catalog version being written does not exist.");

        if (version.State != CatalogVersionStates.Building)
        {
            throw new InvalidOperationException("Only a building catalog version can be written.");
        }

        // Resumable: a previous attempt's rows are replaced whole rather than
        // added to, so a rerun cannot duplicate a title.
        await db.CatalogTitles
            .Where(title => title.VersionId == versionId)
            .ExecuteDeleteAsync(cancellationToken);

        await UpsertServicesAsync(build.Services, cancellationToken);
        await UpsertGenresAsync(build.Titles, cancellationToken);
        await InsertIdentitiesAsync(build.Titles, cancellationToken);

        var records = new List<CatalogTitleRecord>(build.Titles.Count);

        foreach (var title in build.Titles)
        {
            var record = new CatalogTitleRecord
            {
                VersionId = versionId,
                TitleId = title.TitleId,
                Name = title.Name,
                ReleaseYear = title.ReleaseYear,
                MediaType = CatalogMediaTypes.ToWire(title.MediaType),
                Synopsis = title.Synopsis,
                Rating = title.Rating,
                VoteCount = title.VoteCount,
                RuntimeMinutes = title.RuntimeMinutes,
                TrailerUrl = title.TrailerUrl,
                PosterUrl = title.PosterUrl,
                Popularity = title.Popularity,
                InGeneralPool = title.InGeneralPool,
                PoolPosition = title.PoolPosition,
                LastObservedAt = title.LastObservedAt,
            };

            for (var index = 0; index < title.Genres.Count; index++)
            {
                record.Genres.Add(new CatalogTitleGenre
                {
                    VersionId = versionId,
                    TitleId = title.TitleId,
                    GenreId = title.Genres[index],
                    Position = index,
                });
            }

            foreach (var entry in title.Availability)
            {
                record.Availability.Add(new CatalogAvailability
                {
                    VersionId = versionId,
                    TitleId = title.TitleId,
                    ServiceId = entry.ServiceId,
                    Region = build.Region,
                    Monetization = entry.Monetization,
                    DeepLinkUrl = entry.DeepLinkUrl,
                    Position = entry.Position,
                    LastObservedAt = entry.LastObservedAt,
                });
            }

            records.Add(record);
        }

        db.CatalogTitles.AddRange(records);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task PromoteAsync(
        Guid versionId,
        CatalogSnapshot? rollbackSnapshot,
        DateTimeOffset completedAt,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var version = await db.CatalogVersions
            .FirstOrDefaultAsync(row => row.Id == versionId, cancellationToken)
            ?? throw new InvalidOperationException("The catalog version being promoted does not exist.");

        if (version.State != CatalogVersionStates.Building)
        {
            throw new InvalidOperationException("Only a building catalog version can be promoted.");
        }

        var latest = await db.CatalogTitles
            .Where(title => title.VersionId == versionId)
            .MaxAsync(title => (DateTimeOffset?)title.LastObservedAt, cancellationToken);

        // Superseded first: the partial unique index allows one Active per
        // region, and the database is what enforces it.
        await db.CatalogVersions
            .Where(other => other.Region == version.Region && other.State == CatalogVersionStates.Active)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(other => other.State, CatalogVersionStates.Superseded)
                    .SetProperty(other => other.CompletedAt, completedAt),
                cancellationToken);

        version.State = CatalogVersionStates.Active;
        version.CompletedAt = completedAt;
        version.LatestObservedAt = latest;

        if (rollbackSnapshot is { } snapshot)
        {
            version.FetchedAt = snapshot.FetchedAt;
            await WriteRollbackSnapshotAsync(snapshot, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        // The durable document changed inside the transaction; the memory level
        // must not keep serving the previous one. Removing (rather than
        // replacing) the key makes the next read take the row's committed
        // FetchedAt, so the two levels cannot disagree.
        cache.Remove(CatalogSnapshotStore.CacheKey(version.Region));
    }

    /// <inheritdoc />
    public async Task DeleteAsync(Guid versionId, CancellationToken cancellationToken)
    {
        await db.CatalogVersions
            .Where(version => version.Id == versionId && version.State == CatalogVersionStates.Building)
            .ExecuteDeleteAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CatalogTitleRow>> LoadRowsAsync(
        Guid versionId,
        CancellationToken cancellationToken)
    {
        var records = await db.CatalogTitles
            .AsNoTracking()
            .Where(title => title.VersionId == versionId)
            .Include(title => title.Genres)
            .Include(title => title.Availability)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return records.Select(ToRow).ToList();
    }

    /// <inheritdoc />
    public async Task<int> CleanupAsync(
        DateTimeOffset now,
        TimeSpan buildingMaxAge,
        TimeSpan supersededMaxAge,
        CancellationToken cancellationToken)
    {
        var buildingCutoff = now - buildingMaxAge;
        var supersededCutoff = now - supersededMaxAge;

        var stale = await db.CatalogVersions
            .AsNoTracking()
            .Where(version =>
                (version.State == CatalogVersionStates.Building && version.CreatedAt < buildingCutoff)
                || (version.State == CatalogVersionStates.Superseded
                    && (version.CompletedAt ?? version.CreatedAt) < supersededCutoff))
            .Select(version => new { version.Id, version.State })
            .ToListAsync(cancellationToken);

        if (stale.Count == 0)
        {
            return 0;
        }

        var superseded = stale
            .Where(version => version.State == CatalogVersionStates.Superseded)
            .Select(version => version.Id)
            .ToList();

        if (superseded.Count > 0)
        {
            // A title a visitor still references must remain resolvable after
            // the version holding it is deleted (data-model "Retention
            // lifecycle"). The archive copy keeps no availability, so this is
            // an identity rescue rather than a second catalog.
            await ArchiveReferencedAsync(superseded, now, cancellationToken);
        }

        var ids = stale.Select(version => version.Id).ToList();

        await db.CatalogVersions
            .Where(version => ids.Contains(version.Id))
            .ExecuteDeleteAsync(cancellationToken);

        return ids.Count;
    }

    private async Task UpsertServicesAsync(
        IReadOnlyList<CatalogServiceRow> services,
        CancellationToken cancellationToken)
    {
        if (services.Count == 0)
        {
            return;
        }

        var existing = await db.CatalogServices
            .ToDictionaryAsync(service => service.Id, StringComparer.Ordinal, cancellationToken);

        foreach (var service in services)
        {
            if (!existing.TryGetValue(service.Id, out var row))
            {
                db.CatalogServices.Add(new CatalogService
                {
                    Id = service.Id,
                    DisplayName = service.DisplayName,
                    SearchTemplate = service.SearchTemplate,
                    IsQuizService = service.IsQuizService,
                    Position = service.Position,
                });

                continue;
            }

            row.DisplayName = service.DisplayName;
            row.IsQuizService = service.IsQuizService;
            row.Position = service.Position;

            // A carried or observed row may not know the template; an existing
            // template is never overwritten with nothing.
            if (service.SearchTemplate is not null)
            {
                row.SearchTemplate = service.SearchTemplate;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task UpsertGenresAsync(
        IReadOnlyList<CatalogTitleRow> titles,
        CancellationToken cancellationToken)
    {
        var referenced = titles
            .SelectMany(title => title.Genres)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (referenced.Count == 0)
        {
            return;
        }

        var existing = (await db.CatalogGenres
                .Where(genre => referenced.Contains(genre.Id))
                .Select(genre => genre.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var vocabulary = CatalogVocabulary.Genres
            .ToDictionary(genre => genre.Id, StringComparer.Ordinal);

        var position = 1000;

        foreach (var genreId in referenced)
        {
            if (!existing.Add(genreId))
            {
                continue;
            }

            db.CatalogGenres.Add(vocabulary.TryGetValue(genreId, out var seed)
                ? new CatalogGenre
                {
                    Id = seed.Id,
                    DisplayName = seed.DisplayName,
                    TmdbId = seed.TmdbId,
                    IsSelectable = seed.IsSelectable,
                    Position = seed.Position,
                }
                : new CatalogGenre
                {
                    Id = genreId,
                    DisplayName = genreId,
                    TmdbId = null,
                    IsSelectable = false,
                    Position = position++,
                });
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Ensures every title a version stores has a durable identity anchor, so
    /// the user-row foreign keys can point at it (data-model §9).
    /// </summary>
    private async Task InsertIdentitiesAsync(
        IReadOnlyList<CatalogTitleRow> titles,
        CancellationToken cancellationToken)
    {
        var ids = titles
            .Select(title => title.TitleId)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (ids.Length == 0)
        {
            return;
        }

        var firstSeenAt = time.GetUtcNow();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO "CatalogTitleIdentities" ("TitleId", "FirstSeenAt")
             SELECT title_id, {firstSeenAt}
             FROM unnest({ids}) AS title_id
             ON CONFLICT ("TitleId") DO NOTHING
             """,
            cancellationToken);
    }

    /// <summary>
    /// Writes the rollback document inside the promotion transaction (FR-029).
    /// It is the general pool just composed, not a second provider fetch.
    /// </summary>
    private async Task WriteRollbackSnapshotAsync(
        CatalogSnapshot snapshot,
        CancellationToken cancellationToken)
    {
        var payload = CatalogSnapshotJson.Serialize(snapshot);

        if (await db.CatalogSnapshots
                .SingleOrDefaultAsync(row => row.Region == snapshot.Region, cancellationToken) is { } stored)
        {
            stored.FetchedAt = snapshot.FetchedAt;
            stored.PayloadJson = payload;

            return;
        }

        db.CatalogSnapshots.Add(new StoredSnapshot
        {
            Region = snapshot.Region,
            FetchedAt = snapshot.FetchedAt,
            PayloadJson = payload,
        });
    }

    /// <summary>
    /// Copies every referenced title from the versions about to be deleted into
    /// the retired-title archive, keeping its newest observation and no
    /// availability.
    /// </summary>
    private async Task ArchiveReferencedAsync(
        IReadOnlyList<Guid> versionIds,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var records = await db.CatalogTitles
            .AsNoTracking()
            .Where(title => versionIds.Contains(title.VersionId)
                && (db.Interactions.Any(row => row.TitleId == title.TitleId)
                    || db.WatchHistory.Any(row => row.TitleId == title.TitleId)))
            .Include(title => title.Genres)
            .Include(title => title.Availability)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        if (records.Count == 0)
        {
            return;
        }

        var newest = records
            .GroupBy(record => record.TitleId, StringComparer.Ordinal)
            .Select(group => group.OrderByDescending(record => record.LastObservedAt).First())
            .ToList();

        var ids = newest.Select(record => record.TitleId).ToList();

        var archived = await db.CatalogRetiredTitles
            .Where(row => ids.Contains(row.TitleId))
            .ToDictionaryAsync(row => row.TitleId, StringComparer.Ordinal, cancellationToken);

        foreach (var record in newest)
        {
            var payload = CatalogTitleJson.Serialize(ToRow(record).ToCatalogTitle());

            if (archived.TryGetValue(record.TitleId, out var row))
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
    }

    private static CatalogTitleRow ToRow(CatalogTitleRecord record) => new(
        record.TitleId,
        record.Name,
        record.ReleaseYear,
        CatalogMediaTypes.FromWire(record.MediaType) ?? CatalogMediaType.Movie,
        record.Genres.OrderBy(genre => genre.Position).Select(genre => genre.GenreId).ToList(),
        record.Synopsis,
        record.Rating,
        record.VoteCount,
        record.RuntimeMinutes,
        record.TrailerUrl,
        record.PosterUrl,
        record.Popularity,
        record.InGeneralPool,
        record.PoolPosition,
        record.LastObservedAt,
        record.Availability
            .OrderBy(entry => entry.Position)
            .Select(entry => new CatalogAvailabilityRow(
                entry.ServiceId,
                entry.Monetization,
                entry.DeepLinkUrl,
                entry.Position,
                entry.LastObservedAt))
            .ToList());
}

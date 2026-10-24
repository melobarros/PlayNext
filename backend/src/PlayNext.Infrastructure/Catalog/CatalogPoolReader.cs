using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

// The persistence layer's row entity is also called CatalogSnapshot; the alias
// names the wire type this class returns, which is the one every signature here
// means.
using CatalogSnapshot = PlayNext.Application.Contracts.CatalogSnapshot;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The normalized read path (data-model "Query semantics").
///
/// Three request modes, one version pinned for all of them:
/// <list type="bullet">
///   <item><b>No filters</b> — the general pool, in its stored discovery order.
///   This is the backward-compatibility promise: an existing client sees what it
///   saw before (FR-004).</item>
///   <item><b>Any filter</b> — AND across dimensions, OR within each, over the
///   whole version, capped at <c>Catalog:MaxPoolTitles</c> and ordered by
///   popularity. That ordering is a deterministic selection rule, not a
///   ranking; the client re-ranks what it receives (FR-025).</item>
///   <item><b>Ids</b> — the requested titles from the active version, then any
///   that survive only in the archived-title copy. Ids bypass the pool cap but
///   are bounded at the parser.</item>
/// </list>
///
/// Every row carries its own observation time, and one past the retention
/// cutoff is not served even before the purge deletes it (FR-015). That matters
/// because the purge runs at refresh and at startup, while a read can happen at
/// any moment in between.
/// </summary>
public sealed class CatalogPoolReader(
    AppDbContext db,
    TimeProvider time,
    IOptions<CatalogOptions> options) : ICatalogPoolReader
{
    /// <inheritdoc />
    public async Task<CatalogSnapshot> ReadAsync(
        CatalogVersionRef version,
        CatalogPoolQuery query,
        CancellationToken cancellationToken)
    {
        var cutoff = CatalogRetention.Cutoff(time.GetUtcNow());

        var titles = query.HasIds
            ? await ReadByIdsAsync(version, query, cutoff, cancellationToken)
            : await ReadPoolAsync(version, query, cutoff, cancellationToken);

        return new CatalogSnapshot(version.Region, version.FetchedAt, titles);
    }

    private async Task<List<CatalogTitle>> ReadPoolAsync(
        CatalogVersionRef version,
        CatalogPoolQuery query,
        DateTimeOffset cutoff,
        CancellationToken cancellationToken)
    {
        var rows = db.CatalogTitles
            .AsNoTracking()
            .Where(title => title.VersionId == version.Id && title.LastObservedAt >= cutoff);

        if (!query.HasFilters)
        {
            var general = await rows
                .Where(title => title.InGeneralPool)
                .Include(title => title.Genres)
                .Include(title => title.Availability)
                .AsSplitQuery()
                .OrderBy(title => title.PoolPosition)
                .ThenBy(title => title.TitleId)
                .ToListAsync(cancellationToken);

            return general.Select(ToTitle).ToList();
        }

        var targeted = await ApplyFilters(rows, query, version.Region)
            .Include(title => title.Genres)
            .Include(title => title.Availability)
            .AsSplitQuery()
            .OrderByDescending(title => title.Popularity)
            .ThenBy(title => title.TitleId)
            .Take(options.Value.MaxPoolTitles)
            .ToListAsync(cancellationToken);

        return targeted.Select(ToTitle).ToList();
    }

    private async Task<List<CatalogTitle>> ReadByIdsAsync(
        CatalogVersionRef version,
        CatalogPoolQuery query,
        DateTimeOffset cutoff,
        CancellationToken cancellationToken)
    {
        var ids = query.Ids.ToList();

        var rows = db.CatalogTitles
            .AsNoTracking()
            .Where(title =>
                title.VersionId == version.Id
                && ids.Contains(title.TitleId)
                && title.LastObservedAt >= cutoff);

        var records = await ApplyFilters(rows, query, version.Region)
            .Include(title => title.Genres)
            .Include(title => title.Availability)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        // General-pool position where one exists, then popularity, then id — the
        // contract's deterministic order for a batch. Clients look titles up by
        // id, so the order is for reproducibility rather than display.
        var active = records
            .OrderBy(title => title.InGeneralPool ? 0 : 1)
            .ThenBy(title => title.InGeneralPool ? title.PoolPosition : 0)
            .ThenByDescending(title => title.Popularity)
            .ThenBy(title => title.TitleId, StringComparer.Ordinal)
            .Select(ToTitle)
            .ToList();

        var found = records
            .Select(title => title.TitleId)
            .ToHashSet(StringComparer.Ordinal);

        var missing = query.Ids
            .Where(id => !found.Contains(id))
            .ToList();

        if (missing.Count == 0)
        {
            return active;
        }

        var archived = await db.CatalogRetiredTitles
            .AsNoTracking()
            .Where(row => missing.Contains(row.TitleId))
            .ToListAsync(cancellationToken);

        var restored = new List<CatalogTitle>(archived.Count);

        foreach (var row in archived)
        {
            if (CatalogTitleJson.Deserialize(row.PayloadJson) is not { } title)
            {
                continue;
            }

            // An archived title has no availability (it was stripped when the
            // copy was made), so a service filter excludes it — which is the
            // truthful answer: the catalog can no longer prove where it streams.
            if (Matches(title, query))
            {
                restored.Add(title);
            }
        }

        restored.Sort((left, right) => string.CompareOrdinal(left.Id, right.Id));

        return active.Concat(restored).ToList();
    }

    private static IQueryable<CatalogTitleRecord> ApplyFilters(
        IQueryable<CatalogTitleRecord> titles,
        CatalogPoolQuery query,
        string region)
    {
        if (query.Services.Count > 0)
        {
            var services = query.Services.ToList();

            titles = titles.Where(title => title.Availability.Any(entry =>
                entry.Region == region && services.Contains(entry.ServiceId)));
        }

        if (query.Genres.Count > 0)
        {
            var genres = query.Genres.ToList();

            titles = titles.Where(title => title.Genres.Any(entry => genres.Contains(entry.GenreId)));
        }

        if (query.MediaTypes.Count > 0)
        {
            var mediaTypes = query.MediaTypes
                .Select(CatalogMediaTypes.ToWire)
                .ToList();

            titles = titles.Where(title => mediaTypes.Contains(title.MediaType));
        }

        return titles;
    }

    private static bool Matches(CatalogTitle title, CatalogPoolQuery query)
    {
        if (query.Services.Count > 0 && title.Availability.Count == 0)
        {
            return false;
        }

        if (query.Genres.Count > 0
            && !query.Genres.Any(genre => title.Genres.Contains(genre, StringComparer.Ordinal)))
        {
            return false;
        }

        return query.MediaTypes.Count == 0 || query.MediaTypes.Contains(title.MediaType);
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

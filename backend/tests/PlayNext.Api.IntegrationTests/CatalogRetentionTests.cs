using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Contracts;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// The retention purge (T047, FR-015/016, research D5).
///
/// Two obligations pull in opposite directions: provider carriage data must not
/// be kept past the ceiling, and a visitor's rating must not outlive the title
/// it rates. The purge satisfies both by deleting every expired row and
/// copying only the rows a user record still references into the archive —
/// without availability, because carriage is the thing the ceiling governs.
///
/// The purge is driven directly so its outcome counts are in hand, and then the
/// read paths that consult the archive are exercised through the endpoint: an
/// id batch resolves a retired title, a pool request does not, and a version
/// with nothing current answers "not ready" rather than serving old data.
/// </summary>
[Collection("catalog")]
public sealed class Catalog_retention(CatalogApiFactory api) : NormalizedCatalogTest(api)
{
    /// <summary>Action is the first of the nine genres, in the vocabulary and in the stub's bands.</summary>
    private const int ActionBand = 0;

    /// <summary>The title the visitor rated and watched before it aged out.</summary>
    private static readonly string RatedId =
        StubTmdbHandler.SyntheticTitleId(isMovie: true, ActionBand, 1);

    /// <summary>A title nobody referenced: the purge deletes it outright.</summary>
    private static readonly string UnreferencedId =
        StubTmdbHandler.SyntheticTitleId(isMovie: true, ActionBand, 2);

    /// <summary>One full refresh over the stub's bands, leaving an active version to age.</summary>
    private async Task<CatalogVersion> DeepCatalogAsync()
    {
        await _api.ResetCatalogAsync();
        UseNormalized();

        var run = await RefreshAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, run!.Status);

        return await ActiveVersionOrFailAsync();
    }

    /// <summary>An observation time comfortably past the six-month ceiling.</summary>
    private static DateTimeOffset ExpiredAt() =>
        DateTimeOffset.UtcNow.Subtract(CatalogRetention.Limit).AddDays(-20);

    /// <summary>Ages the named rows, and their availability, past the ceiling.</summary>
    private Task<int> AgeTitlesAsync(Guid versionId, params string[] titleIds)
    {
        var observedAt = ExpiredAt();

        return WithDbAsync(async db =>
        {
            var titles = await db.CatalogTitles
                .Where(title => title.VersionId == versionId && titleIds.Contains(title.TitleId))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(title => title.LastObservedAt, observedAt));

            await db.CatalogAvailability
                .Where(entry => entry.VersionId == versionId && titleIds.Contains(entry.TitleId))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(entry => entry.LastObservedAt, observedAt));

            return titles;
        });
    }

    /// <summary>
    /// Ages every row of a version, and the version's own watermark — the value
    /// the read gate consults before it looks at any row.
    /// </summary>
    private Task<int> AgeWholeVersionAsync(Guid versionId)
    {
        var observedAt = ExpiredAt();
        DateTimeOffset? latest = observedAt;

        return WithDbAsync(async db =>
        {
            var titles = await db.CatalogTitles
                .Where(title => title.VersionId == versionId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(title => title.LastObservedAt, observedAt));

            await db.CatalogVersions
                .Where(version => version.Id == versionId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(version => version.LatestObservedAt, latest));

            return titles;
        });
    }

    /// <summary>Registers a visitor who loved and watched <see cref="RatedId"/>.</summary>
    private Task<HttpClient> SignUpWithRatingAsync() =>
        SignUpAsync(new JsonObject
        {
            ["interactions"] = new JsonObject
            {
                [RatedId] = new JsonObject
                {
                    ["state"] = "loved",
                    ["updatedAt"] = "2026-10-23T10:00:00Z",
                },
            },
            ["history"] = new JsonArray
            {
                new JsonObject { ["titleId"] = RatedId, ["chosenAt"] = "2026-10-23T10:00:00Z" },
            },
        });

    /// <summary>The rows a purge has no business touching.</summary>
    private async Task<int[]> UserRowCountsAsync()
    {
        var interactions = await WithDbAsync(db => db.Interactions.CountAsync());
        var history = await WithDbAsync(db => db.WatchHistory.CountAsync());

        return [interactions, history];
    }

    [Fact]
    public async Task The_purge_deletes_expired_rows_and_archives_only_the_referenced_title()
    {
        var active = await DeepCatalogAsync();

        await SignUpWithRatingAsync();

        var userRows = await UserRowCountsAsync();

        Assert.Equal(2, await AgeTitlesAsync(active.Id, RatedId, UnreferencedId));

        var outcome = await PurgeAsync();

        // Both expired rows are deleted; only the rated one is archived, and the
        // archive is not purged of it on the same run because a visitor still
        // references it.
        Assert.Equal(2, outcome.DeletedTitles);
        Assert.Equal(1, outcome.ArchivedTitles);
        Assert.Equal(0, outcome.DeletedArchiveRows);

        // The rows are gone from the version, availability included (the
        // availability rows are the title rows' children).
        var remaining = await WithDbAsync(db => db.CatalogTitles
            .CountAsync(title => title.VersionId == active.Id
                && (title.TitleId == RatedId || title.TitleId == UnreferencedId)));

        Assert.Equal(0, remaining);

        var leftoverAvailability = await WithDbAsync(db => db.CatalogAvailability
            .CountAsync(entry => entry.VersionId == active.Id
                && (entry.TitleId == RatedId || entry.TitleId == UnreferencedId)));

        Assert.Equal(0, leftoverAvailability);

        // The archive copy is the wire title with no availability: the ceiling
        // governs carriage data, not the title's identity.
        var retired = Assert.Single(await WithDbAsync(db => db.CatalogRetiredTitles
            .AsNoTracking()
            .ToListAsync()));

        Assert.Equal(RatedId, retired.TitleId);

        var payload = JsonNode.Parse(retired.PayloadJson)!.AsObject();

        Assert.Equal(RatedId, payload["id"]!.GetValue<string>());
        Assert.Empty(payload["availability"]!.AsArray());

        // An id batch still resolves the rated title — a watchlist entry must
        // not outlive the thing it points at — while the title nobody
        // referenced is simply absent.
        var body = await CatalogAsync("BR", $"ids={RatedId},{UnreferencedId}");

        Assert.Equal(new[] { RatedId }, Ids(body));
        Assert.Empty(BadgeIds(TitleById(body, RatedId)));

        // A pool read does not consult the archive: it is not a second catalog.
        var pool = Ids(await CatalogAsync("BR", "genres=action&mediaTypes=movie"));

        Assert.NotEmpty(pool);
        Assert.DoesNotContain(RatedId, pool);
        Assert.DoesNotContain(UnreferencedId, pool);

        // The purge deleted catalog rows and touched nothing a visitor owns.
        Assert.Equal(userRows, await UserRowCountsAsync());

        // Once the visitor's records are gone, the next purge drops the copy.
        await WithDbAsync(async db =>
        {
            await db.Interactions
                .Where(row => row.TitleId == RatedId)
                .ExecuteDeleteAsync();

            await db.WatchHistory
                .Where(row => row.TitleId == RatedId)
                .ExecuteDeleteAsync();

            return 0;
        });

        var second = await PurgeAsync();

        Assert.Equal(0, second.DeletedTitles);
        Assert.Equal(0, second.ArchivedTitles);
        Assert.Equal(1, second.DeletedArchiveRows);

        Assert.Equal(0, await WithDbAsync(db => db.CatalogRetiredTitles.CountAsync()));
    }

    [Fact]
    public async Task An_over_age_version_answers_not_ready_and_the_read_starts_its_replacement()
    {
        var active = await DeepCatalogAsync();
        var titlesBefore = await TitleCountAsync(active.Id);

        await AgeWholeVersionAsync(active.Id);

        // Nothing in the version is inside the ceiling, so it is treated as
        // absent rather than served old (FR-015).
        var (status, _, body) = await CatalogResponseAsync("BR");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, status);
        Assert.Equal("catalog-not-ready", body["code"]!.GetValue<string>());

        // The refusal purged what it could not serve, which is what leaves the
        // version with no current observation at all.
        Assert.Equal(0, await TitleCountAsync(active.Id));

        // And it is not a dead end: the read started the refresh that replaces
        // the expired version.
        await _api.WaitForIdleAsync("BR");

        var refreshed = await ActiveVersionOrFailAsync();

        Assert.NotEqual(active.Id, refreshed.Id);
        Assert.False(CatalogRetention.IsVersionExpired(
            refreshed.LatestObservedAt,
            DateTimeOffset.UtcNow));
        Assert.Equal(titlesBefore, await TitleCountAsync(refreshed.Id));

        var (recovered, _, _) = await CatalogResponseAsync("BR");

        Assert.Equal(HttpStatusCode.OK, recovered);
    }
}

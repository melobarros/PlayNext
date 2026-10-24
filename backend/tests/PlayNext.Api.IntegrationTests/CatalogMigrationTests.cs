using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// What a migration promises the deployment (T019).
///
/// The migration is the one operation that rewrites the catalog from data it did
/// not fetch, so its awkward cases matter more than its happy path: rerunning it
/// must not double the catalog, a newer snapshot must win over a build that was
/// interrupted, and an unreadable snapshot must fail the run rather than half
/// the catalog. The suite also holds the reason the identity table exists: a
/// visitor can rate a card from a version the catalog no longer serves.
///
/// The use case is driven directly, as in the rest of the normalized suites —
/// what a migration stores is the question, and a 202 plus a poll would only add
/// a race in front of the answer.
/// </summary>
[Collection("catalog")]
public sealed class Catalog_migration(CatalogApiFactory api) : NormalizedCatalogTest(api)
{
    /// <summary>
    /// Three titles chosen so the snapshot's own arrays are countable by hand:
    /// three availability entries, five genre assignments and three distinct
    /// genres.
    /// </summary>
    private static JsonObject[] Fixture() =>
    [
        SnapshotTitle(
            "tmdb:movie:27205",
            "Inception",
            2010,
            "movie",
            ["action", "drama"],
            availability:
            [
                ("netflix", "https://www.netflix.com/search?q=Inception"),
                ("prime-video", "https://www.primevideo.com/search?phrase=Inception"),
            ]),

        // No availability at all: a title with nothing to count is where a
        // flattened count would divide by the wrong array.
        SnapshotTitle("tmdb:tv:1396", "Breaking Bad", 2008, "tv", ["drama"]),

        SnapshotTitle(
            "tmdb:movie:129",
            "Spirited Away",
            2001,
            "anime",
            ["animation", "drama"],
            availability: [("max", "https://play.max.com/search?q=Spirited%20Away")]),
    ];

    private async Task SeedAsync()
    {
        var fetchedAt = Recently();

        await _api.StorePayloadAsync("BR", SnapshotPayload("BR", fetchedAt, Fixture()), fetchedAt);
    }

    /// <summary>The rows a version holds, one count per table the snapshot becomes.</summary>
    private async Task<(int Titles, int Genres, int Availability)> StoredRowsAsync(Guid versionId) =>
        await WithDbAsync(async db =>
        {
            var titles = await db.CatalogTitles.CountAsync(title => title.VersionId == versionId);
            var genres = await db.CatalogTitleGenres.CountAsync(genre => genre.VersionId == versionId);
            var availability = await db.CatalogAvailability.CountAsync(entry => entry.VersionId == versionId);

            return (titles, genres, availability);
        });

    /// <summary>
    /// The rows a catalog operation has no business touching: ratings, the
    /// watching log, and the identity anchors both point at.
    /// </summary>
    private async Task<int[]> UserRowCountsAsync()
    {
        var interactions = await WithDbAsync(db => db.Interactions.CountAsync());
        var history = await WithDbAsync(db => db.WatchHistory.CountAsync());
        var identities = await WithDbAsync(db => db.CatalogTitleIdentities.CountAsync());

        return [interactions, history, identities];
    }

    /// <summary>
    /// Starts a build and never finishes it — what a migration that died
    /// mid-build leaves behind, and the state a newer snapshot has to replace.
    /// </summary>
    private async Task<Guid> SeedStaleBuildAsync(string region, DateTimeOffset fetchedAt)
    {
        using var scope = _api.Services.CreateScope();

        var start = await scope.ServiceProvider
            .GetRequiredService<ICatalogVersionStore>()
            .BeginBuildAsync(region, fetchedAt, CatalogVersionSource.Migration, CancellationToken.None);

        return start.VersionId;
    }

    /// <summary>The error line the latest run stored, which the summary does not carry.</summary>
    private Task<string?> LatestRunErrorAsync() =>
        WithDbAsync(db => db.CatalogRefreshRuns
            .AsNoTracking()
            .OrderByDescending(run => run.StartedAt)
            .Select(run => run.Error)
            .FirstOrDefaultAsync());

    [Fact]
    public async Task Rerunning_with_the_same_snapshot_timestamp_creates_no_duplicates()
    {
        await _api.ResetCatalogAsync();
        await SeedAsync();

        var first = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, first!.Status);
        Assert.NotNull(first.VersionId);

        var versionId = first.VersionId!.Value;

        Assert.Equal(0, first.Counts!["migration"].Skipped);

        var storedOnce = await StoredRowsAsync(versionId);

        Assert.Equal((3, 5, 3), storedOnce);

        // The second run is the deployment's retry: the same snapshot timestamp
        // is already active, so the work is finished rather than redone
        // (research D6).
        var second = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, second!.Status);
        Assert.Equal(first.VersionId, second.VersionId);
        Assert.Equal(3, second.Counts!["migration"].Skipped);

        // One version, one copy of every row — a rebuild would have replaced the
        // rows' timestamps as well as possibly duplicating them.
        var active = Assert.Single(await VersionsAsync());

        Assert.Equal(versionId, active.Id);
        Assert.Equal(storedOnce, await StoredRowsAsync(versionId));
    }

    [Fact]
    public async Task Counts_and_stored_rows_equal_the_snapshot_arrays()
    {
        await _api.ResetCatalogAsync();
        await SeedAsync();

        var run = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, run!.Status);

        var counts = run.Counts!["migration"];

        // The two intents agree by construction, so the counts are the snapshot's
        // own arrays: three titles, three offers, five genre assignments and the
        // three genres they name.
        Assert.Equal(3, counts.Discovered);
        Assert.Equal(3, counts.Fresh);
        Assert.Equal(0, counts.Carried);
        Assert.Equal(0, counts.Skipped);
        Assert.Equal(0, counts.Enriched);
        Assert.Equal(3, counts.AvailabilityEntries);
        Assert.Equal(3, counts.Genres);

        // And what was written is what was counted: a mapping that dropped a
        // title's second genre or collapsed two offers would report the arrays
        // faithfully and store something smaller.
        Assert.Equal((3, 5, 3), await StoredRowsAsync(run.VersionId!.Value));

        // Every title is anchored before anything can reference it (data-model
        // §9) — the rows are the foreign keys' targets.
        var anchored = await WithDbAsync(db => db.CatalogTitleIdentities
            .CountAsync(identity =>
                identity.TitleId == "tmdb:movie:27205"
                || identity.TitleId == "tmdb:tv:1396"
                || identity.TitleId == "tmdb:movie:129"));

        Assert.Equal(3, anchored);
    }

    [Fact]
    public async Task A_newer_snapshot_discards_the_stale_building_version()
    {
        await _api.ResetCatalogAsync();

        var staleAt = Recently();

        await _api.StorePayloadAsync(
            "BR",
            SnapshotPayload("BR", staleAt, SnapshotTitle("tmdb:movie:27205", "Inception", 2010, "movie", ["action"])),
            staleAt);

        var staleId = await SeedStaleBuildAsync("BR", staleAt);

        // The snapshot the migration will actually read is newer than the build
        // that is half-written: the interrupted build is stale data and must not
        // block or half-fill the version that replaces it.
        var newerAt = staleAt.AddMinutes(5);

        await _api.StorePayloadAsync(
            "BR",
            SnapshotPayload(
                "BR",
                newerAt,
                SnapshotTitle("tmdb:movie:550", "Fight Club", 1999, "movie", ["drama"]),
                SnapshotTitle("tmdb:movie:157336", "Interstellar", 2014, "movie", ["sci-fi"])),
            newerAt);

        var run = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, run!.Status);
        Assert.NotNull(run.VersionId);

        var active = Assert.Single(await VersionsAsync());

        Assert.Equal(run.VersionId, active.Id);
        Assert.NotEqual(staleId, active.Id);
        Assert.Equal(CatalogVersionStates.Active, active.State);
        Assert.Equal(newerAt, active.FetchedAt);

        // Gone rather than left beside the new version: the partial unique index
        // allows one building version per region, and the replacement is what
        // lets it accept the new one.
        Assert.Equal(0, await TitleCountAsync(staleId));

        var titles = await WithDbAsync(db => db.CatalogTitles
            .AsNoTracking()
            .Where(title => title.VersionId == active.Id)
            .OrderBy(title => title.PoolPosition)
            .Select(title => title.TitleId)
            .ToListAsync());

        // The new snapshot's titles, in its order — not the stale one's, and not
        // a mixture of the two.
        Assert.Equal(new[] { "tmdb:movie:550", "tmdb:movie:157336" }, titles);
    }

    [Fact]
    public async Task An_unreadable_snapshot_fails_the_run_and_leaves_users_and_versions_alone()
    {
        await _api.ResetCatalogAsync();

        // A visitor's rows, which no catalog operation has any business
        // rewriting. The rating's identity anchor is created with it.
        const string RatedId = "tmdb:movie:424242";

        await SignUpAsync(new JsonObject
        {
            ["interactions"] = new JsonObject
            {
                [RatedId] = new JsonObject { ["state"] = "loved", ["updatedAt"] = "2026-10-23T10:00:00Z" },
            },
            ["history"] = new JsonArray
            {
                new JsonObject { ["titleId"] = RatedId, ["chosenAt"] = "2026-10-23T10:00:00Z" },
            },
        });

        var usersBefore = await UserRowCountsAsync();

        // 1. No snapshot at all: the region has never been fetched.
        var missing = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Failed, missing!.Status);
        Assert.Null(missing.VersionId);
        Assert.Empty(missing.Counts!);
        await AssertFailureIsTheUnreadableSnapshotAsync();
        Assert.Empty(await VersionsAsync());

        // 2. Well-formed JSON that is not a snapshot. The row is refused but
        // kept: a process that cannot read it is not obviously the one that
        // should destroy it (research D10).
        await _api.StorePayloadAsync("BR", "[]", Recently());

        var malformed = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Failed, malformed!.Status);
        await AssertFailureIsTheUnreadableSnapshotAsync();
        Assert.Equal("[]", await _api.StoredPayloadAsync("BR"));
        Assert.Empty(await VersionsAsync());

        // 3. A snapshot past the provider's retention ceiling: refused *and*
        // purged, because the terms prohibit keeping it, not only serving it.
        var old = DateTimeOffset.UtcNow.AddDays(-200);

        await _api.StorePayloadAsync(
            "BR",
            SnapshotPayload(
                "BR",
                old,
                SnapshotTitle("tmdb:movie:550", "Fight Club", 1999, "movie", ["drama"])),
            old);

        var overAge = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Failed, overAge!.Status);
        await AssertFailureIsTheUnreadableSnapshotAsync();
        Assert.Null(await _api.StoredPayloadAsync("BR"));
        Assert.Empty(await VersionsAsync());

        // None of the three left a version to promote, and none touched a row a
        // visitor owns.
        Assert.Equal(usersBefore, await UserRowCountsAsync());
    }

    /// <summary>
    /// All three refusals are the store's one answer — "nothing readable" — rather
    /// than three different exceptions reaching the run log, which is what an
    /// operator reads to decide whether to rerun or to investigate.
    /// </summary>
    private async Task AssertFailureIsTheUnreadableSnapshotAsync()
    {
        var error = await LatestRunErrorAsync() ?? string.Empty;

        Assert.Contains("no readable snapshot", error);
    }

    [Fact]
    public async Task A_rating_for_a_title_the_catalog_has_never_seen_still_saves_and_anchors_an_identity()
    {
        await _api.ResetCatalogAsync();

        const string UnseenId = "tmdb:movie:909999";

        var client = await SignUpAsync(new JsonObject
        {
            ["interactions"] = new JsonObject
            {
                [UnseenId] = new JsonObject { ["state"] = "loved", ["updatedAt"] = "2026-10-23T10:00:00Z" },
            },
        });

        // Read back through the endpoint rather than the registration response:
        // a response computed in memory agrees with a write that never landed.
        var response = await client.GetAsync("/api/me/state");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var stored = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

        Assert.True(stored["interactions"]!.AsObject().ContainsKey(UnseenId));

        // The catalog holds no version at all, so nothing could have supplied
        // the row the interaction's foreign key points at — it had to be created
        // with the rating, in the same transaction (data-model §9).
        Assert.Empty(await VersionsAsync());

        var rated = await WithDbAsync(db => db.Interactions
            .AnyAsync(row => row.TitleId == UnseenId));

        Assert.True(rated);

        var anchored = await WithDbAsync(db => db.CatalogTitleIdentities
            .AnyAsync(row => row.TitleId == UnseenId));

        Assert.True(anchored);
    }
}

using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Contracts;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// The migration's parity claim (T018): for one frozen snapshot, the normalized
/// response is the snapshot response — same ids, same order, same genres, same
/// badges, same links — and the snapshot is still there to roll back to.
///
/// The comparison is on the raw response bodies rather than field by field. Two
/// payloads built by two code paths are only equal in the way the client cares
/// about if the bytes match; a field-by-field check would politely ignore a
/// reordered genre list or a changed key name, both of which the deck's parity
/// harness (T017) would then find for us in a way that is harder to explain.
/// </summary>
[Collection("catalog")]
public sealed class The_migration_keeps_the_deck_identical(CatalogApiFactory api) : NormalizedCatalogTest(api)
{
    private static JsonObject[] Fixture() =>
    [
        SnapshotTitle(
            "tmdb:movie:27205",
            "Inception",
            2010,
            "movie",
            ["action", "thriller"],
            rating: 8.4,
            votes: 36_000,
            runtimeMinutes: 148,
            trailerUrl: "https://www.youtube.com/watch?v=YoHD9XEInc0",
            posterUrl: "https://image.tmdb.org/t/p/w500/inception.jpg",
            availability:
            [
                ("netflix", "https://www.netflix.com/search?q=Inception"),
                ("tmdb:300", "https://pluto.tv/en/search?q=Inception"),
            ]),

        SnapshotTitle(
            "tmdb:tv:1396",
            "Breaking Bad",
            2008,
            "tv",
            ["drama", "sci-fi-and-fantasy"],
            rating: 8.9,
            votes: 14_000,
            runtimeMinutes: null,
            posterUrl: "https://image.tmdb.org/t/p/w500/breaking-bad.jpg",
            availability:
            [
                ("prime-video", "https://www.primevideo.com/search?phrase=Breaking%20Bad"),
            ]),

        // The classification override: an underlying film presented as anime.
        SnapshotTitle(
            "tmdb:movie:129",
            "Spirited Away",
            2001,
            "anime",
            ["animation", "drama"],
            rating: 8.5,
            votes: 15_000,
            runtimeMinutes: 125,
            posterUrl: "https://image.tmdb.org/t/p/w500/spirited-away.jpg",
            availability:
            [
                ("netflix", "https://www.netflix.com/search?q=Spirited%20Away"),
            ]),

        // No availability and no artwork: the title whose wire shape is all
        // nulls, which is where a mapping that defaulted a field goes wrong.
        SnapshotTitle(
            "tmdb:movie:550",
            "Fight Club",
            1999,
            "movie",
            ["drama", "thriller"],
            rating: 8.4,
            votes: 29_000,
            runtimeMinutes: 139),
    ];

    private async Task<DateTimeOffset> SeedAsync()
    {
        var fetchedAt = Recently();

        await _api.StorePayloadAsync("BR", SnapshotPayload("BR", fetchedAt, Fixture()), fetchedAt);

        return fetchedAt;
    }

    [Fact]
    public async Task The_migrated_catalog_serves_the_snapshot_field_for_field()
    {
        await _api.ResetCatalogAsync();
        await SeedAsync();

        var (snapshotStatus, snapshotBody, _) = await CatalogResponseAsync("BR");
        Assert.Equal(HttpStatusCode.OK, snapshotStatus);

        var run = await MigrateAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, run!.Status);
        Assert.NotNull(run.VersionId);

        UseNormalized();

        var (normalizedStatus, normalizedBody, _) = await CatalogResponseAsync("BR");
        Assert.Equal(HttpStatusCode.OK, normalizedStatus);

        Assert.Equal(snapshotBody, normalizedBody);
    }

    [Fact]
    public async Task The_snapshot_serves_again_after_a_restart_like_memory_clear()
    {
        await _api.ResetCatalogAsync();
        var fetchedAt = Recently();
        var payload = SnapshotPayload("BR", fetchedAt, Fixture());
        await _api.StorePayloadAsync("BR", payload, fetchedAt);

        var (_, before, _) = await CatalogResponseAsync("BR");

        await MigrateAsync();
        UseNormalized();
        var (_, afterMigration, _) = await CatalogResponseAsync("BR");
        Assert.Equal(before, afterMigration);

        // The rollback is configuration plus a restart: the only thing that
        // changes is which store the read path consults.
        UseSnapshot();
        _api.ClearMemory();

        var (rollbackStatus, rollbackBody, _) = await CatalogResponseAsync("BR");

        Assert.Equal(HttpStatusCode.OK, rollbackStatus);
        Assert.Equal(before, rollbackBody);

        // And the migration left the durable row alone: rolling back must not
        // depend on the migration having kept a copy.
        var stored = await _api.StoredPayloadAsync("BR");

        Assert.NotNull(stored);
        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(payload), JsonNode.Parse(stored!)),
            "the stored snapshot was rewritten by the migration");
    }

    [Fact]
    public async Task The_migration_promotes_one_active_version_with_every_title_in_the_general_pool()
    {
        await _api.ResetCatalogAsync();
        var fetchedAt = await SeedAsync();

        await MigrateAsync();

        var versions = await VersionsAsync();
        var active = Assert.Single(versions);

        Assert.Equal(CatalogVersionStates.Active, active.State);
        Assert.Equal(CatalogVersionSources.Migration, active.Source);
        Assert.Equal(fetchedAt, active.FetchedAt);
        Assert.NotNull(active.CompletedAt);

        var titles = await WithDbAsync(db => db.CatalogTitles
            .AsNoTracking()
            .Where(title => title.VersionId == active.Id)
            .OrderBy(title => title.PoolPosition)
            .ToListAsync());

        Assert.Equal(
            new[] { "tmdb:movie:27205", "tmdb:tv:1396", "tmdb:movie:129", "tmdb:movie:550" },
            titles.Select(title => title.TitleId));

        // The snapshot carried no popularity and no general-pool flag; the
        // migration invents neither. Order is the array's own.
        Assert.All(titles, title => Assert.True(title.InGeneralPool));
        Assert.All(titles, title => Assert.Equal(0, title.Popularity));
        Assert.Equal(Enumerable.Range(0, titles.Count), titles.Select(title => title.PoolPosition));
    }
}

/// <summary>
/// The targeted pool and the id batch (T030), driven through the real endpoint
/// against a deep refresh of the stub's synthetic bands.
///
/// The expectations are derived from the stub's own published rules
/// (<see cref="StubTmdbHandler.Carries"/>, <see cref="StubTmdbHandler.IsAnime"/>)
/// rather than hard-coded id lists. A hard-coded list would still pass if the
/// reader returned the whole version in any order; deriving it pins both
/// membership and order to the rule the catalog claims to implement.
/// </summary>
[Collection("catalog")]
public sealed class Targeted_pools(CatalogApiFactory api) : NormalizedCatalogTest(api)
{
    private const int HorrorGenreId = 27;

    private static readonly int HorrorBand = StubTmdbHandler.BandIndex(HorrorGenreId);

    private async Task<CatalogVersion> DeepCatalogAsync()
    {
        await _api.ResetCatalogAsync();
        UseNormalized();

        var run = await RefreshAsync();

        Assert.Equal(CatalogRunStatus.Succeeded, run!.Status);

        return await ActiveVersionOrFailAsync();
    }

    private static int ServiceIndex(string serviceId) =>
        Array.FindIndex(StubTmdbHandler.QuizServices, entry => entry.ServiceId == serviceId);

    /// <summary>
    /// The band indices a service's genre query discovers: everything it
    /// carries, most popular first, cut at the configured depth.
    /// </summary>
    private int[] DiscoveredIndicesFor(string serviceId)
    {
        var service = ServiceIndex(serviceId);

        return [.. Enumerable.Range(0, StubTmdbHandler.BandTitles)
            .Where(index => StubTmdbHandler.Carries(service, index))
            .OrderBy(index => index)
            .Take(ProviderOptions.ServiceTitlesPerGenre)];
    }

    private static string[] InPoolOrder(IEnumerable<string> ids) =>
        [.. ids.OrderByDescending(StubTmdbHandler.PopularityOf)
            .ThenBy(id => id, StringComparer.Ordinal)];

    [Fact]
    public async Task Targeted_requests_return_only_matching_titles_with_the_unchanged_shape()
    {
        await DeepCatalogAsync();

        var movie = await CatalogAsync("BR", "services=netflix&genres=horror&mediaTypes=movie");

        var expected = DiscoveredIndicesFor("netflix")
            .Where(index => !StubTmdbHandler.IsAnime(index))
            .Select(index => StubTmdbHandler.SyntheticTitleId(isMovie: true, HorrorBand, index));

        Assert.Equal(InPoolOrder(expected), Ids(movie));

        // The wire shape is the one the deck has consumed since 002 — the
        // filters change which titles arrive, never what a title looks like.
        var first = movie["titles"]!.AsArray()[0]!.AsObject();

        Assert.Equal(
            new[]
            {
                "id",
                "title",
                "releaseYear",
                "mediaType",
                "genres",
                "synopsis",
                "rating",
                "voteCount",
                "runtimeMinutes",
                "trailerUrl",
                "posterUrl",
                "availability",
            },
            first.Select(pair => pair.Key));

        // Two services: OR inside the dimension, so the pool is the union of
        // what each carries — a visitor who pays for both wants either.
        var both = await CatalogAsync("BR", "services=netflix,max&genres=horror&mediaTypes=movie");
        var ids = Ids(both);

        var netflix = DiscoveredIndicesFor("netflix").ToHashSet();
        var max = DiscoveredIndicesFor("max").ToHashSet();

        var expectedBoth = netflix
            .Union(max)
            .Where(index => !StubTmdbHandler.IsAnime(index))
            .Select(index => StubTmdbHandler.SyntheticTitleId(isMovie: true, HorrorBand, index));

        Assert.Equal(InPoolOrder(expectedBoth), ids);
        Assert.Equal(ids.Length, ids.Distinct(StringComparer.Ordinal).Count());

        // The badge list is the title's whole availability, not just the
        // services this request asked about — a card shows every place it
        // streams. Each badge appears once: two provider ids for one service
        // fold into one badge.
        var titles = both["titles"]!.AsArray().Select(node => node!.AsObject()).ToList();

        foreach (var title in titles)
        {
            var badges = BadgeIds(title);

            Assert.True(
                badges.Contains("netflix") || badges.Contains("max"),
                $"{title["id"]} is in the union but on neither service");
            Assert.Equal(badges.Length, badges.Distinct(StringComparer.Ordinal).Count());
        }

        // The titles both services carry are exactly the intersection, and they
        // are the ones that show both badges.
        var shared = titles
            .Where(title => BadgeIds(title).Contains("netflix") && BadgeIds(title).Contains("max"))
            .Select(title => title["id"]!.GetValue<string>());

        Assert.Equal(
            InPoolOrder(netflix.Intersect(max)
                .Where(index => !StubTmdbHandler.IsAnime(index))
                .Select(index => StubTmdbHandler.SyntheticTitleId(isMovie: true, HorrorBand, index))),
            shared);

        // A well-formed combination that currently matches nothing is a
        // catalog with nothing in it, not an error: the client renders an empty
        // deck, and the next catalog may contain what this one does not.
        var empty = await CatalogAsync("BR", "services=no-such-service&genres=horror");

        Assert.Empty(Ids(empty));
    }

    [Fact]
    public async Task A_filtered_pool_is_capped_and_ordered_by_popularity()
    {
        await DeepCatalogAsync();

        // The suite configures Catalog:MaxPoolTitles = 137 (see
        // CatalogApiFactory): small enough that the synthetic catalog exceeds
        // it several times over, so truncation is what the assertions see.
        var cap = CatalogOptions.MaxPoolTitles;

        Assert.Equal(137, cap);

        var movie = await CatalogAsync("BR", "mediaTypes=movie");
        var movieIds = Ids(movie);

        Assert.Equal(cap, movieIds.Length);
        Assert.Equal(movieIds.Length, movieIds.Distinct(StringComparer.Ordinal).Count());

        // Band 0, index 1 is the most popular presentation movie (index 0 is
        // anime); the cut lands 32 films into band 3.
        Assert.Equal("tmdb:movie:600001", movieIds[0]);
        Assert.Equal("tmdb:movie:603039", movieIds[^1]);

        var popularities = movieIds.Select(StubTmdbHandler.PopularityOf).ToList();

        Assert.Equal(popularities.OrderByDescending(value => value), popularities);

        // The anime presentation type has its own interleaving: per band, each
        // index contributes a film and a series before the next index.
        var animeIds = Ids(await CatalogAsync("BR", "mediaTypes=anime"));

        Assert.Equal(cap, animeIds.Length);
        Assert.Equal("tmdb:movie:600000", animeIds[0]);
        Assert.Equal("tmdb:movie:607025", animeIds[^1]);
    }

    [Fact]
    public async Task Ids_resolve_from_the_active_version_then_the_archive()
    {
        var active = await DeepCatalogAsync();

        // Not on Netflix, and on it — both in the version through other
        // services, so the service filter is the only difference.
        var plainId = StubTmdbHandler.SyntheticTitleId(isMovie: true, HorrorBand, 1);
        var netflixId = StubTmdbHandler.SyntheticTitleId(isMovie: true, HorrorBand, 4);

        const string ArchivedId = "tmdb:movie:888888";

        await WithDbAsync(async db =>
        {
            // A title the purge already retired, exactly as the archive holds
            // one: the wire title with no availability.
            db.CatalogTitleIdentities.Add(new CatalogTitleIdentity
            {
                TitleId = ArchivedId,
                FirstSeenAt = DateTimeOffset.UtcNow,
            });
            db.CatalogRetiredTitles.Add(new CatalogRetiredTitle
            {
                TitleId = ArchivedId,
                PayloadJson = SnapshotTitle(ArchivedId, "A Retired Film", 1999, "movie", ["drama"]).ToJsonString(),
                LastObservedAt = DateTimeOffset.UtcNow.AddDays(-200),
                RetiredAt = DateTimeOffset.UtcNow,
            });

            return await db.SaveChangesAsync();
        });

        // Active first, then the archive; an id the catalog has never heard of
        // is simply absent from the answer.
        var body = await CatalogAsync(
            "BR", $"ids={ArchivedId},{plainId},{netflixId},tmdb:movie:777777");

        Assert.Equal(new[] { plainId, netflixId, ArchivedId }, Ids(body));

        // Ids and filters intersect exactly as the dimensions intersect with
        // each other: every requested title must also satisfy the filter.
        var filtered = await CatalogAsync("BR", $"ids={plainId},{netflixId}&services=netflix");

        Assert.Equal(new[] { netflixId }, Ids(filtered));

        // The id batch is not a pool: a watchlist can hold more titles than the
        // pool cap allows to be served at once.
        var many = await WithDbAsync(db => db.CatalogTitles
            .AsNoTracking()
            .Where(title => title.VersionId == active.Id && !title.InGeneralPool)
            .OrderBy(title => title.TitleId)
            .Select(title => title.TitleId)
            .Take(140)
            .ToListAsync());

        Assert.Equal(140, many.Count);

        var byIds = await CatalogAsync("BR", "ids=" + string.Join(',', many));

        Assert.Equal(140, Ids(byIds).Length);
    }

    [Fact]
    public async Task Each_syntax_error_returns_its_contract_code()
    {
        // Validation happens before the catalog is consulted, so this test does
        // not need a version — which is itself the point: a typo must be
        // refused without starting hundreds of upstream calls.
        await _api.ResetCatalogAsync();

        var cases = new (string Query, string Code)[]
        {
            ("services=Netflix", "invalid-service"),
            ("genres=Horror", "invalid-genre"),
            ("mediaTypes=documentary", "invalid-media-type"),
            ("ids=hereditary", "invalid-title-id"),
        };

        foreach (var (query, code) in cases)
        {
            var (status, _, body) = await CatalogResponseAsync("BR", query);

            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.Equal(code, body["code"]!.GetValue<string>());
        }

        var maxIds = CatalogOptions.MaxIdsPerRequest;

        var tooMany = string.Join(',', Enumerable.Range(1, maxIds + 1).Select(id => $"tmdb:movie:{id}"));

        var oversized = await CatalogResponseAsync("BR", "ids=" + tooMany);

        Assert.Equal(HttpStatusCode.BadRequest, oversized.Status);
        Assert.Equal("too-many-ids", oversized.Body["code"]!.GetValue<string>());
    }
}

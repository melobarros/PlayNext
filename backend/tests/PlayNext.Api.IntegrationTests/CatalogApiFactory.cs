using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using PlayNext.Application.Interfaces;
using PlayNext.Infrastructure.Catalog;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Starts the real API for the catalog suite, with the provider replaced by
/// <see cref="StubTmdbHandler"/>.
///
/// The substitution happens at the HTTP boundary rather than at the port: the
/// real <c>TmdbClient</c> runs, with its real request shapes, its real
/// throttling and its real parsing — only the socket is fake. A test that
/// swapped out <c>ICatalogProvider</c> instead would prove the endpoint works
/// with a catalog handed to it, which is not the claim these tests need to
/// settle.
///
/// The suite never needs a live credential, so it is never gated on one: the
/// key is present because the host refuses to start without it, and points at a
/// stub host that no real request can escape to.
/// </summary>
public sealed class CatalogApiFactory : WebApplicationFactory<Program>
{
    /// <summary>A placeholder, not a credential — <see cref="StubTmdbHandler"/> answers every call.</summary>
    private const string TestTmdbKey = "test-placeholder-not-a-credential";

    private const string TestSigningKey = "b7e2c1a94f8d3b6e0a5c9d2f7b4e1a8c3d6f9b2e5a8c1d4f7b0e3a6c9d2f5b8e1";

    /// <summary>The stub host. Never resolved — the primary handler intercepts first.</summary>
    public const string StubBaseUrl = "https://stub.tmdb.invalid/3";

    /// <summary>
    /// Every region the suites exercise, and the ones a reset clears.
    ///
    /// A list rather than a single region because the region tests hold two
    /// regions at once: a reset that cleared only the one under test would leave
    /// the other's snapshot behind and make the next test's "never retrieved"
    /// claim true only by accident.
    /// </summary>
    public static readonly string[] Regions = ["BR", "US", "GB", "PT", "CA"];

    /// <summary>The provider stand-in, reachable so a test can take it down mid-scenario.</summary>
    public StubTmdbHandler Tmdb { get; } = new();

    public CatalogApiFactory()
    {
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("ConnectionStrings__Postgres", Postgres.ConnectionString);
        Environment.SetEnvironmentVariable("Jwt__SigningKey", TestSigningKey);
        Environment.SetEnvironmentVariable("Tmdb__ApiKey", TestTmdbKey);
        Environment.SetEnvironmentVariable("Tmdb__BaseUrl", StubBaseUrl);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        builder.ConfigureTestServices(services =>
        {
            // The same registration the host made — same service, same
            // implementation — so this lands on the same named client and the
            // stub is what the pipeline's HttpClient ends up with. Naming the
            // implementation type instead would register a *different* client
            // whose handler the provider never sees, and every request would go
            // to the real network.
            services
                .AddHttpClient<ICatalogProvider, TmdbClient>()
                .ConfigurePrimaryHttpMessageHandler(() => Tmdb);
        });
    }

    /// <summary>
    /// Returns the suite to a state where nothing has ever been retrieved for
    /// any region: the durable rows are deleted and the in-memory level is
    /// emptied.
    ///
    /// Both levels, because a snapshot surviving in either one would make a
    /// later test's "never fetched" assertion pass for the wrong reason.
    /// </summary>
    public async Task ResetCatalogAsync()
    {
        Tmdb.IsDown = false;
        Tmdb.RefusesWith = null;
        Tmdb.Requests.Clear();

        using (var scope = Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("DELETE FROM \"CatalogSnapshots\"");
        }

        ClearMemory();
    }

    /// <summary>
    /// Empties the in-memory level only, leaving the durable rows alone.
    ///
    /// What a process restart looks like from the database's point of view —
    /// which is the case the durable level exists for (research D10). The API is
    /// hosted scale-to-zero, so "the first visitor after every scale-up" is a
    /// scheduled event rather than a rare one, and a memory-only cache would
    /// make that visitor pay for the whole retrieval.
    /// </summary>
    public void ClearMemory()
    {
        // The memory cache is a singleton on the host, so clearing it means
        // reaching into the running host's container rather than disposing it.
        // The key comes from the store rather than from a literal here: a test
        // that emptied a key the store does not use would leave a snapshot
        // behind and pass for the wrong reason.
        if (Services.GetService<Microsoft.Extensions.Caching.Memory.IMemoryCache>() is { } cache)
        {
            foreach (var region in Regions)
            {
                cache.Remove(CatalogSnapshotStore.CacheKey(region));
            }
        }
    }

    /// <summary>
    /// The durable row's payload for a region, exactly as stored — or
    /// <c>null</c> when the region has no row.
    /// </summary>
    public async Task<string?> StoredPayloadAsync(string region)
    {
        using var scope = Services.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.CatalogSnapshots
            .Where(row => row.Region == region)
            .Select(row => row.PayloadJson)
            .SingleOrDefaultAsync();
    }

    /// <summary>
    /// Puts a payload in the durable row for a region, as some other version of
    /// the server might have left it.
    ///
    /// Must be valid jsonb — the column would reject anything else, which is one
    /// class of damage the database already prevents. What this writes is the
    /// other class: well-formed JSON that is not a snapshot.
    /// </summary>
    public async Task StorePayloadAsync(string region, string payloadJson, DateTimeOffset fetchedAt)
    {
        using var scope = Services.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (await db.CatalogSnapshots.SingleOrDefaultAsync(row => row.Region == region) is { } existing)
        {
            existing.PayloadJson = payloadJson;
            existing.FetchedAt = fetchedAt;
        }
        else
        {
            db.CatalogSnapshots.Add(new CatalogSnapshot
            {
                Region = region,
                PayloadJson = payloadJson,
                FetchedAt = fetchedAt,
            });
        }

        await db.SaveChangesAsync();
    }
}

/// <summary>
/// A deterministic stand-in for the TMDB API.
///
/// It answers the two shapes the catalog actually asks for — a discover page
/// and an enriched title — from one fixed catalog, so a title appearing in
/// discover and the same title's detail agree with each other. That agreement
/// is what lets a test assert an id, a genre and a badge link together.
///
/// The catalog is deliberately small and deliberately awkward: it contains a
/// Western animated film (not anime), a Japanese live-action film (not anime),
/// a title with no poster, and a title with no availability in one region.
/// Those are the cases where a plausible-looking implementation goes wrong.
/// </summary>
public sealed class StubTmdbHandler : HttpMessageHandler
{
    /// <summary>How many tiles each discover page holds, matching TMDB's own page size.</summary>
    private const int PageSize = 20;

    /// <summary>Every upstream request this stub answered, for assertions about call counts.</summary>
    public List<string> Requests { get; } = [];

    /// <summary>When set, every call fails as a network error — the provider being unreachable.</summary>
    public bool IsDown { get; set; }

    /// <summary>
    /// When set, every call is answered with this status instead of a payload —
    /// the provider being reachable and refusing.
    ///
    /// A distinct failure from <see cref="IsDown"/> rather than another way of
    /// writing it, because the two take different paths through the client: an
    /// unreachable host throws at the socket, while a refusal arrives as a
    /// response that has to be read and judged. A 429 additionally carries
    /// <c>Retry-After</c>, which is the only upstream instruction the batch
    /// obeys (research D16).
    /// </summary>
    public HttpStatusCode? RefusesWith { get; set; }

    private static readonly StubTitle[] Catalog =
    [
        // A film with two mapped genres, available differently per region, and
        // a trailer — the ordinary case the contract examples are written from.
        new(27205, IsMovie: true, "Inception", [28, 53], "en", 148, "/inception.jpg",
            Rating: 8.4, Votes: 36_000, Year: 2010, Overview: "A thief who steals corporate secrets."),

        // A film with one mapped genre and one unmapped one: keeps its tag.
        new(157336, IsMovie: true, "Interstellar", [878, 12], "en", 169, "/interstellar.jpg",
            Rating: 8.4, Votes: 34_000, Year: 2014, Overview: "A team travels through a wormhole."),

        // A series. No runtime, because episode lengths are not a title runtime.
        new(1396, IsMovie: false, "Breaking Bad", [18, 10765], "en", 0, "/breaking-bad.jpg",
            Rating: 8.9, Votes: 14_000, Year: 2008, Overview: "A chemistry teacher turns to crime."),

        // Anime: animation *and* Japanese.
        new(1429, IsMovie: false, "Attack on Titan", [16, 10759], "ja", 0, "/aot.jpg",
            Rating: 8.7, Votes: 9_000, Year: 2013, Overview: "Humanity fights giant humanoids."),

        // Anime that is a film: the classification overrides the underlying type.
        new(129, IsMovie: true, "Spirited Away", [16, 18], "ja", 125, "/spirited-away.jpg",
            Rating: 8.5, Votes: 15_000, Year: 2001, Overview: "A girl enters a world of spirits."),

        // Animation, but not Japanese — must stay a movie.
        new(862, IsMovie: true, "Toy Story", [16, 10751], "en", 81, "/toy-story.jpg",
            Rating: 8.0, Votes: 18_000, Year: 1995, Overview: "Toys come to life when humans leave."),

        // Japanese, but not animation — must stay a movie.
        new(346, IsMovie: true, "Seven Samurai", [28, 18], "ja", 207, "/seven-samurai.jpg",
            Rating: 8.6, Votes: 3_500, Year: 1954, Overview: "A village hires seven ronin."),

        // No artwork: the client's CSS placeholder path.
        new(550, IsMovie: true, "Fight Club", [18, 53], "en", 139, null,
            Rating: 8.4, Votes: 29_000, Year: 1999, Overview: "An insomniac meets a soap salesman."),
    ];

    /// <summary>
    /// Which services carry a title in a region, under a monetization type.
    /// Keyed by <c>(titleId, region)</c>; a title absent from this table is
    /// carried nowhere, which is a normal answer rather than an error.
    /// </summary>
    private static readonly Dictionary<(int Id, string Region), (int ProviderId, string Type)[]> Availability = new()
    {
        // Inception: different services in different regions — the case the
        // region tests turn on.
        [(27205, "BR")] = [(8, "flatrate"), (300, "flatrate")],
        [(27205, "US")] = [(15, "flatrate")],
        [(27205, "GB")] = [(8, "flatrate")],

        // Only a rental in BR: filtered out, so the badge list is empty there.
        [(157336, "BR")] = [(2, "rent")],
        [(157336, "US")] = [(337, "flatrate")],

        [(1396, "BR")] = [(119, "flatrate")],
        [(1429, "BR")] = [(283, "flatrate"), (8, "flatrate")],
        [(129, "BR")] = [(8, "free")],

        // A service the quiz does not offer, plus an ad-supported tier — both
        // must appear, one as a pass-through and one as Netflix.
        [(862, "BR")] = [(1796, "ads"), (192, "ads")],

        // A service the vocabulary has never heard of: excluded, not invented.
        [(346, "BR")] = [(999_999, "flatrate")],

        // Deliberately absent: Fight Club is carried nowhere in BR.
    };

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var url = request.RequestUri!;
        Requests.Add(url.PathAndQuery);

        if (IsDown)
        {
            // What an unreachable host actually looks like to HttpClient.
            throw new HttpRequestException("The stub provider is down.");
        }

        if (RefusesWith is { } refusal)
        {
            var refused = new HttpResponseMessage(refusal);

            if (refusal == HttpStatusCode.TooManyRequests)
            {
                // The header the provider would send, and the only part of a
                // refusal the batch reads.
                refused.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(
                    TimeSpan.FromSeconds(30));
            }

            return refused;
        }

        // The suite never talks to a real host: a BaseUrl that escaped the stub
        // would silently make these tests depend on the network.
        if (!url.Host.EndsWith("invalid", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"The catalog tests must never reach {url.Host}.");
        }

        var path = url.AbsolutePath;
        var query = QueryHelpers.ParseQuery(url.Query);

        var payload = Shape(path) switch
        {
            "discover" => Discover(path, query),
            "title" => Detail(path),

            // Named rather than left to surface as a parse error three frames
            // down: an unrecognised path almost always means the base address
            // and the relative path did not compose the way the caller assumed,
            // and that is worth saying out loud.
            _ => throw new InvalidOperationException(
                $"The stub catalog provider does not recognise {path}. It answers "
                + "'/{version}/discover/{movie|tv}' and '/{version}/{movie|tv}/{id}'."),
        };

        await Task.Yield();

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
        };
    }

    /// <summary>Which of the two upstream shapes a path names, if either.</summary>
    private static string Shape(string path)
    {
        if (path.Contains("/discover/", StringComparison.Ordinal))
        {
            return "discover";
        }

        // "/3/movie/27205" — a media type segment followed by a numeric id.
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);

        return segments.Length >= 2
            && segments[^2] is "movie" or "tv"
            && int.TryParse(segments[^1], out _)
                ? "title"
                : "unknown";
    }

    /// <summary>Answers a discover query: the catalog filtered the way TMDB filters it.</summary>
    private static JsonNode Discover(string path, Dictionary<string, StringValues> query)
    {
        var isMovie = path.Contains("/discover/movie", StringComparison.Ordinal);
        var genreIds = query.TryGetValue("with_genres", out var genres) && genres.Count > 0
            ? genres.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray()
            : [];
        var language = query.TryGetValue("with_original_language", out var languages) && languages.Count > 0
            ? languages.ToString()
            : null;
        var page = query.TryGetValue("page", out var pages) && int.TryParse(pages.ToString(), out var parsed)
            ? parsed
            : 1;

        var matches = Catalog
            .Where(title => title.IsMovie == isMovie)
            .Where(title => genreIds.Length == 0 || genreIds.All(genreId => title.GenreIds.Contains(genreId)))
            .Where(title => language is null || title.Language == language)
            .ToArray();

        var pageItems = matches.Skip((page - 1) * PageSize).Take(PageSize).ToArray();

        var results = new JsonArray();

        foreach (var title in pageItems)
        {
            results.Add(new JsonObject
            {
                ["id"] = title.Id,
                ["title"] = title.IsMovie ? title.Title : null,
                ["name"] = title.IsMovie ? null : title.Title,
                ["genre_ids"] = new JsonArray(title.GenreIds.Select(id => (JsonNode)id).ToArray()),
                ["original_language"] = title.Language,
                ["overview"] = title.Overview,
                ["poster_path"] = title.PosterPath,
                ["vote_average"] = title.Rating,
                ["vote_count"] = title.Votes,
                ["release_date"] = title.IsMovie ? $"{title.Year}-01-01" : null,
                ["first_air_date"] = title.IsMovie ? null : $"{title.Year}-01-01",
            });
        }

        return new JsonObject
        {
            ["page"] = page,
            ["results"] = results,
            ["total_pages"] = (int)Math.Ceiling(matches.Length / (double)PageSize),
            ["total_results"] = matches.Length,
        };
    }

    /// <summary>Answers an enriched title query: detail, providers and videos in one body.</summary>
    private static JsonNode Detail(string path)
    {
        // "/3/movie/27205" or "/3/tv/1396"
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var isMovie = segments[^2] == "movie";
        var id = int.Parse(segments[^1]);

        var title = Catalog.Single(entry => entry.Id == id && entry.IsMovie == isMovie);

        var providersByRegion = new JsonObject();

        foreach (var region in new[] { "BR", "US", "GB" })
        {
            var carries = Availability.GetValueOrDefault((id, region));

            if (carries is null)
            {
                continue;
            }

            var buckets = new Dictionary<string, JsonArray>(StringComparer.Ordinal);

            foreach (var (providerId, type) in carries)
            {
                if (!buckets.TryGetValue(type, out var bucket))
                {
                    bucket = [];
                    buckets[type] = bucket;
                }

                bucket.Add(new JsonObject
                {
                    ["provider_id"] = providerId,
                    ["provider_name"] = $"Provider {providerId}",
                    ["display_priority"] = 1,
                });
            }

            var inRegion = new JsonObject
            {
                ["link"] = $"https://www.themoviedb.org/{segments[^2]}/{id}/watch",
            };

            // Each bucket is attached exactly once, where it is built. A
            // JsonNode holds a reference to its parent, so a bucket parked in
            // one object and then assigned into another throws rather than
            // copying — and an absent bucket is absent here too, which is how
            // TMDB answers as well.
            foreach (var (type, bucket) in buckets)
            {
                inRegion[type] = bucket;
            }

            providersByRegion[region] = inRegion;
        }

        return new JsonObject
        {
            ["id"] = title.Id,
            ["title"] = title.IsMovie ? title.Title : null,
            ["name"] = title.IsMovie ? null : title.Title,
            ["original_language"] = title.Language,
            ["overview"] = title.Overview,
            ["poster_path"] = title.PosterPath,
            ["vote_average"] = title.Rating,
            ["vote_count"] = title.Votes,
            ["runtime"] = title.IsMovie ? title.Runtime : null,
            ["release_date"] = title.IsMovie ? $"{title.Year}-01-01" : null,
            ["first_air_date"] = title.IsMovie ? null : $"{title.Year}-01-01",
            ["genres"] = new JsonArray(title.GenreIds.Select(genreId => (JsonNode)new JsonObject
            {
                ["id"] = genreId,
                ["name"] = $"Genre {genreId}",
            }).ToArray()),
            ["watch/providers"] = new JsonObject { ["results"] = providersByRegion },
            ["videos"] = new JsonObject
            {
                // One title has a trailer, and it is the one the contract
                // examples are written from; every other title has none, which
                // is the ordinary case.
                ["results"] = title.Id == 27205
                    ? new JsonArray(new JsonObject
                    {
                        ["key"] = "YoHD9XEInc0",
                        ["site"] = "YouTube",
                        ["type"] = "Trailer",
                    })
                    : new JsonArray(),
            },
        };
    }

    /// <summary>One entry in the stub's catalog.</summary>
    private sealed record StubTitle(
        int Id,
        bool IsMovie,
        string Title,
        int[] GenreIds,
        string Language,
        int Runtime,
        string? PosterPath,
        double Rating,
        int Votes,
        int Year,
        string Overview);
}

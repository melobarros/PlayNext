using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;
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
public class CatalogApiFactory : WebApplicationFactory<Program>
{
    /// <summary>A placeholder, not a credential — <see cref="StubTmdbHandler"/> answers every call.</summary>
    private const string TestTmdbKey = "test-placeholder-not-a-credential";

    private const string TestSigningKey = "b7e2c1a94f8d3b6e0a5c9d2f7b4e1a8c3d6f9b2e5a8c1d4f7b0e3a6c9d2f5b8e1";

    /// <summary>The stub host. Never resolved — the primary handler intercepts first.</summary>
    public const string StubBaseUrl = "https://stub.tmdb.invalid/3";

    /// <summary>
    /// The admin token the suite presents. Not a credential: it exists only so
    /// the host maps the admin routes, and the value is compared, never logged.
    /// </summary>
    public const string TestAdminToken = "test-admin-token-not-a-credential";

    /// <summary>
    /// Every region the suites exercise, and the ones a reset clears.
    ///
    /// A list rather than a single region because the region tests hold two
    /// regions at once: a reset that cleared only the one under test would leave
    /// the other's snapshot behind and make the next test's "never retrieved"
    /// claim true only by accident.
    /// </summary>
    public static readonly string[] Regions = ["BR", "US", "GB", "PT", "CA"];

    /// <summary>
    /// The configuration the catalog host is built with, layered over the app's
    /// own sources. Mutable, and read by <see cref="MutableConfigurationSource"/>
    /// on every reload, so <see cref="SetSetting"/> can change a value and have
    /// the running host bind it again.
    ///
    /// Every value is a test-tuning decision, not a production default:
    /// <list type="bullet">
    ///   <item><c>Tmdb:ServiceTitlesPerGenre = 40</c> — two discovery pages of
    ///   twenty, so a service + genre pool is provably deeper than one page and
    ///   the quota, not the provider, is what stops it.</item>
    ///   <item><c>Tmdb:RequestsPerSecond = 100000</c> — the stub answers
    ///   instantly and a full refresh makes ~1,400 calls; real pacing would
    ///   only make the suite slow.</item>
    ///   <item><c>Tmdb:MaxRetries = 1</c> — an injected 5xx is retried exactly
    ///   once: the retry path is exercised without tripling a failed slice's
    ///   cost.</item>
    ///   <item><c>Catalog:MaxPoolTitles = 137</c> — a cap the synthetic catalog
    ///   exceeds by several bands, so truncation is observable and its ordering
    ///   is checkable.</item>
    ///   <item><c>Catalog:AdminToken</c> — the admin routes are only mapped
    ///   when a token is configured, so the suite must configure one.</item>
    /// </list>
    /// </summary>
    protected readonly Dictionary<string, string?> Settings = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Catalog:Source"] = "Snapshot",
        ["Catalog:AdminToken"] = TestAdminToken,
        ["Catalog:MaxPoolTitles"] = "137",
        ["Tmdb:ServiceTitlesPerGenre"] = "40",
        ["Tmdb:RequestsPerSecond"] = "100000",
        ["Tmdb:MaxRetries"] = "1",
    };

    /// <summary>The provider stand-in, reachable so a test can take it down mid-scenario.</summary>
    public StubTmdbHandler Tmdb { get; } = new();

    /// <summary>
    /// Every line the running host logged. The admin token and the titles the
    /// refresh sees must never appear in one (FR-017, T049), and a log is the
    /// one output a response-shape assertion cannot speak for.
    /// </summary>
    public RecordingLog Logs { get; } = new();

    public CatalogApiFactory()
    {
        // The guards Program.cs reads *before* it builds the host (connection
        // string, signing key, provider key) can only come from the process
        // environment: an in-memory source added by a factory callback arrives
        // at Build(), which is after those guards have run.
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("ConnectionStrings__Postgres", Postgres.ConnectionString);
        Environment.SetEnvironmentVariable("Jwt__SigningKey", TestSigningKey);
        Environment.SetEnvironmentVariable("Tmdb__ApiKey", TestTmdbKey);
        Environment.SetEnvironmentVariable("Tmdb__BaseUrl", StubBaseUrl);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        builder.ConfigureLogging(logging => logging.AddProvider(new RecordingLoggerProvider(Logs)));

        // A source that reads the dictionary again on every reload, so
        // SetSetting + Reload re-binds options to what the test just wrote.
        // AddInMemoryCollection looks equivalent but is not: it copies the
        // dictionary into the provider when the host is built, so a later
        // reload would re-read the original values and the rollback switch
        // (FR-007) would appear to work while still serving the old path.
        // This source lands during Build(), which is early enough for options
        // (bound lazily) and for route mapping (which reads the admin token),
        // but not for the startup guards — see the constructor.
        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.Add(new MutableConfigurationSource(Settings)));

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
    /// Changes one setting and reloads the host's configuration.
    ///
    /// This is the rollback switch's test seam (FR-007): <c>Catalog:Source</c>
    /// is read through <c>IOptionsMonitor</c> on every request, and a reload is
    /// what makes the monitor re-bind. Values read through <c>IOptions</c> are
    /// bound once, so nothing a test flips at runtime may be read that way.
    /// </summary>
    public void SetSetting(string key, string? value)
    {
        Settings[key] = value;

        var configuration = (IConfigurationRoot)Services.GetRequiredService<IConfiguration>();
        configuration.Reload();
    }

    /// <summary>
    /// Waits until no background retrieval is running for the given regions
    /// (all of them by default).
    ///
    /// A read of a cold or stale catalog starts a retrieval in the background
    /// and answers <c>503</c> immediately. That work outlives the response, so
    /// the next test would otherwise race a batch that writes rows for a region
    /// it is about to reset.
    /// </summary>
    public async Task WaitForIdleAsync(params string[] regions)
    {
        var refresher = Services.GetRequiredService<ICatalogRefresher>();
        var waitingFor = regions.Length == 0 ? Regions : regions;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(60);

        foreach (var region in waitingFor)
        {
            while (refresher.IsRunning(region))
            {
                if (DateTimeOffset.UtcNow > deadline)
                {
                    throw new TimeoutException(
                        $"The catalog retrieval for {region} did not finish within the suite's budget.");
                }

                await Task.Delay(25);
            }
        }
    }

    /// <summary>
    /// Returns the suite to a state where nothing has ever been retrieved for
    /// any region: the durable rows are deleted and the in-memory level is
    /// emptied.
    ///
    /// Both storage generations are cleared — the 005 snapshot and the 008
    /// versions — because leaving either behind would make a later test's
    /// "never fetched" assertion pass for the wrong reason.
    /// </summary>
    public async Task ResetCatalogAsync()
    {
        // Back to the legacy source first: a test that switched to the
        // normalized path must not leak that choice into the next one.
        SetSetting("Catalog:Source", "Snapshot");

        // A test that paused the provider to inspect a running refresh must not
        // leave that refresh — or this reset's wait — blocked forever.
        Tmdb.Release();

        // A retrieval started by the previous test writes its rows when it
        // finishes; deleting underneath it would make it fail on a version that
        // no longer exists — or worse, leave rows the next test never asked for.
        await WaitForIdleAsync();

        Tmdb.Reset();

        using (var scope = Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Children first. Runs point at versions, retirement copies point
            // at identities, and the user tables' identity foreign keys are
            // RESTRICT — deleting identities a visitor still references would
            // be rejected.
            await db.Database.ExecuteSqlRawAsync("DELETE FROM \"CatalogRefreshRuns\"");
            await db.Database.ExecuteSqlRawAsync("DELETE FROM \"CatalogRetiredTitles\"");
            await db.Database.ExecuteSqlRawAsync("DELETE FROM \"CatalogVersions\"");
            await db.Database.ExecuteSqlRawAsync(
                """
                DELETE FROM "CatalogTitleIdentities"
                WHERE "TitleId" NOT IN (SELECT "TitleId" FROM "Interactions")
                  AND "TitleId" NOT IN (SELECT "TitleId" FROM "WatchHistory")
                """);
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
/// A configuration source over the factory's mutable settings dictionary.
///
/// The dictionary is the source of truth, not a snapshot of it: <see cref="MutableConfigurationProvider.Load"/>
/// reads it again whenever the configuration reloads, which is what makes
/// <see cref="CatalogApiFactory.SetSetting"/> able to change a value the running
/// host already bound.
/// </summary>
public sealed class MutableConfigurationSource(IDictionary<string, string?> values) : IConfigurationSource
{
    public IConfigurationProvider Build(IConfigurationBuilder builder) =>
        new MutableConfigurationProvider(values);
}

/// <summary>The provider half of <see cref="MutableConfigurationSource"/>.</summary>
public sealed class MutableConfigurationProvider(IDictionary<string, string?> values) : ConfigurationProvider
{
    public override void Load() =>
        Data = new Dictionary<string, string?>(values, StringComparer.OrdinalIgnoreCase);

    public override void Set(string key, string? value)
    {
        values[key] = value;
        Data[key] = value;
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
///
/// <b>Two catalogs, selected by the query (feature 008).</b> A discover call
/// <i>without</i> <c>with_watch_providers</c> is the general recipe and is
/// answered from the handcrafted titles above, exactly as it was for 005 —
/// byte for byte, because the suite's request-count assertions compare two such
/// batches. A discover call <i>with</i> provider ids is a service slice and is
/// answered from synthetic bands instead: nine genre bands of forty-five
/// titles, of which each service carries forty-one. That is what makes a
/// service + genre pool deep enough to prove it is not the general sample.
/// </summary>
public sealed class StubTmdbHandler : HttpMessageHandler
{
    /// <summary>How many tiles each discover page holds, matching TMDB's own page size.</summary>
    public const int PageSize = 20;

    /// <summary>
    /// How many titles one synthetic genre band holds.
    ///
    /// Deliberately more than any query's target: with
    /// <c>ServiceTitlesPerGenre = 40</c> a query fills its quota while the band
    /// still has titles left, so "the quota stopped it" cannot be confused with
    /// "the provider ran out of titles".
    /// </summary>
    public const int BandTitles = 45;

    /// <summary>
    /// How many of a band's <see cref="BandTitles"/> one service carries: every
    /// index except four. The gap (and the fact that it slides with the service
    /// index) is what lets a test prove that a service-filtered pool is the
    /// service's own catalog rather than a slice of everyone's.
    /// </summary>
    public const int ServiceDepthPerGenre = BandTitles - 4;

    /// <summary>
    /// A provider id the vocabulary has never heard of. The normalized path
    /// keeps it as data and falls back to the region watch page (FR-010).
    /// </summary>
    public const int UnknownProviderId = 999_998;

    private const int MovieIdBase = 600_000;
    private const int TvIdBase = 700_000;

    /// <summary>One in five titles is anime: animation + Japanese, the classification's conjunction.</summary>
    private const int AnimeStride = 5;

    /// <summary>
    /// MUBI, in <see cref="QuizServices"/> order. Its titles also carry
    /// <see cref="UnknownProviderId"/>, so the region-watch-page fallback has a
    /// case to answer without every title growing a second badge.
    /// </summary>
    private const int UnknownProviderServiceIndex = 7;

    /// <summary>
    /// The eleven quiz services, in the slice plan's order, with the provider
    /// aliases folded in exactly as the vocabulary folds them. A test can use
    /// an index here with <see cref="Carries"/> to derive what a service's
    /// pool must contain instead of hard-coding it.
    /// </summary>
    public static readonly (int[] ProviderIds, string ServiceId)[] QuizServices =
    [
        ([8, 1796], "netflix"),
        ([119, 2100], "prime-video"),
        ([337], "disney-plus"),
        ([1899], "max"),
        ([350], "apple-tv-plus"),
        ([531], "paramount-plus"),
        ([283], "crunchyroll"),
        ([11], "mubi"),
        ([307], "globoplay"),
        ([15], "hulu"),
        ([386], "peacock"),
    ];

    /// <summary>
    /// Every upstream request this stub answered, for assertions about call
    /// counts.
    ///
    /// A refresh keeps several calls in flight, so this list is appended from
    /// more than one thread. Tests read it — and call <see cref="Reset"/> — only
    /// once the run is idle, so <see cref="_requestsSync"/> needs to guard the
    /// writing side alone.
    /// </summary>
    public List<string> Requests { get; } = [];

    private readonly object _requestsSync = new();

    /// <summary>
    /// How many calls have arrived so far, read safely while a refresh is still
    /// running — the one number a concurrency test needs mid-flight.
    /// </summary>
    public int RequestCount
    {
        get
        {
            lock (_requestsSync)
            {
                return Requests.Count;
            }
        }
    }

    /// <summary>When set, every call fails as a network error — the provider being unreachable.</summary>
    public bool IsDown { get; set; }

    /// <summary>The gate every upstream call waits behind while it is held.</summary>
    private readonly object _gateSync = new();

    private TaskCompletionSource _gate = Completed();

    /// <summary>
    /// Holds every upstream call until <see cref="Release"/>.
    ///
    /// A refresh is otherwise over before a test can look at it — the stub
    /// answers instantly — so the one state the admin surface must be tested in
    /// (a run actually in progress) would be unreachable without pausing the
    /// provider. Holding the socket rather than slowing the run keeps the test
    /// deterministic: the refresh is in flight exactly as long as the test says.
    /// </summary>
    public void Hold()
    {
        lock (_gateSync)
        {
            if (_gate.Task.IsCompleted)
            {
                _gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }
    }

    /// <summary>Lets every held call proceed, and leaves the gate open.</summary>
    public void Release()
    {
        TaskCompletionSource gate;

        lock (_gateSync)
        {
            gate = _gate;
            _gate = Completed();
        }

        gate.TrySetResult();
    }

    private Task GateAsync()
    {
        lock (_gateSync)
        {
            return _gate.Task;
        }
    }

    private static TaskCompletionSource Completed()
    {
        var source = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        source.SetResult();

        return source;
    }

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

    /// <summary>
    /// Provider ids whose discovery queries fail with <see cref="FailureStatus"/>
    /// — one service slice failing while the others succeed.
    ///
    /// Failure is scoped to the <i>discover</i> call because that is what names
    /// a service; the enrichment of titles already found is left alone, which
    /// is also what the real provider's failures look like from the batch's
    /// point of view: a slice is failable, its queries are its own.
    /// </summary>
    public HashSet<int> FailingProviderIds { get; } = [];

    /// <summary>The status injected for <see cref="FailingProviderIds"/>; a 5xx so the client's retry path runs.</summary>
    public HttpStatusCode FailureStatus { get; set; } = HttpStatusCode.InternalServerError;

    /// <summary>Returns the stub to its opening state, including the injected failures.</summary>
    public void Reset()
    {
        // A test that aborted while holding the gate must not leave every later
        // call — and the reset's own WaitForIdle — waiting on a task nobody will
        // complete.
        Release();
        IsDown = false;
        RefusesWith = null;
        FailureStatus = HttpStatusCode.InternalServerError;
        FailingProviderIds.Clear();

        lock (_requestsSync)
        {
            Requests.Clear();
        }
    }

    /// <summary>
    /// Whether service <paramref name="serviceIndex"/> carries title
    /// <paramref name="titleIndex"/> of a band: every index but four, sliding
    /// with the service.
    /// </summary>
    public static bool Carries(int serviceIndex, int titleIndex) =>
        ((titleIndex - serviceIndex) % BandTitles + BandTitles) % BandTitles >= 4;

    /// <summary>A provider genre id's band position, or −1 when the quiz does not offer it.</summary>
    public static int BandIndex(int genreId)
    {
        for (var index = 0; index < CatalogVocabulary.GenreIds.Count; index++)
        {
            if (CatalogVocabulary.GenreIds[index] == genreId)
            {
                return index;
            }
        }

        return -1;
    }

    /// <summary>A band title's provider id, as the discover and detail payloads carry it.</summary>
    public static int SyntheticId(bool isMovie, int bandIndex, int titleIndex) =>
        (isMovie ? MovieIdBase : TvIdBase) + bandIndex * 1000 + titleIndex;

    /// <summary>A band title's catalog identity, <c>tmdb:{movie|tv}:{id}</c>.</summary>
    public static string SyntheticTitleId(bool isMovie, int bandIndex, int titleIndex) =>
        CatalogClassification.BuildTitleId(isMovie, SyntheticId(isMovie, bandIndex, titleIndex));

    /// <summary>
    /// A synthetic catalog id's discovery popularity, read back from the id —
    /// the value the targeted-pool ordering is asserted against.
    /// </summary>
    public static double PopularityOf(string titleId)
    {
        var isMovie = titleId.Contains(":movie:", StringComparison.Ordinal);
        var id = int.Parse(titleId[(titleId.LastIndexOf(':') + 1)..]);
        var (band, index) = SyntheticPosition(isMovie, id);

        return PopularityFor(band, index);
    }

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
    /// Which services carry a handcrafted title in a region, under a
    /// monetization type. Keyed by <c>(titleId, region)</c>; a title absent
    /// from this table is carried nowhere, which is a normal answer rather than
    /// an error.
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

    /// <summary>
    /// Names for the synthetic offers, so the service rows the normalized path
    /// creates read like a provider's answer rather than like ids.
    /// </summary>
    private static readonly Dictionary<int, string> ProviderNames = new()
    {
        [8] = "Netflix",
        [1796] = "Netflix",
        [119] = "Prime Video",
        [2100] = "Prime Video",
        [337] = "Disney Plus",
        [1899] = "HBO Max",
        [350] = "Apple TV Plus",
        [531] = "Paramount Plus",
        [283] = "Crunchyroll",
        [11] = "MUBI",
        [307] = "Globoplay",
        [15] = "Hulu",
        [386] = "Peacock",
        [UnknownProviderId] = "Regional Stream",
    };

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var url = request.RequestUri!;

        lock (_requestsSync)
        {
            Requests.Add(url.PathAndQuery);
        }

        // The test decides how long a refresh takes: a held gate keeps this
        // call — and the slice waiting on it — in flight until Release.
        await GateAsync().WaitAsync(cancellationToken);

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

        if (Shape(path) == "discover" && Fails(query))
        {
            // The shape a real 5xx arrives in: a status the client retries to
            // its budget and then reports as the slice's failure.
            await Task.Yield();

            return new HttpResponseMessage(FailureStatus)
            {
                Content = new StringContent(
                    "{\"status_message\":\"the stub refused this slice\"}",
                    Encoding.UTF8,
                    "application/json"),
            };
        }

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

    /// <summary>Whether an injected slice failure applies to this discover query.</summary>
    private bool Fails(Dictionary<string, StringValues> query)
    {
        if (FailingProviderIds.Count == 0)
        {
            return false;
        }

        return ParseInts(Get(query, "with_watch_providers"), '|')
            .Any(FailingProviderIds.Contains);
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

    /// <summary>
    /// Answers a discover query: the handcrafted catalog for the general
    /// recipe, a synthetic band for a service slice.
    /// </summary>
    private static JsonNode Discover(string path, Dictionary<string, StringValues> query)
    {
        var isMovie = path.Contains("/discover/movie", StringComparison.Ordinal);

        // The presence of provider ids is what distinguishes the two recipes.
        // The general slice never sends them, and answering it from the bands
        // would change what the legacy request-count assertions are counting.
        return ParseInts(Get(query, "with_watch_providers"), '|') is { Length: > 0 } providers
            ? DiscoverService(isMovie, query, providers)
            : DiscoverLegacy(isMovie, query);
    }

    /// <summary>Answers a discover query from the handcrafted catalog, filtered the way TMDB filters it.</summary>
    private static JsonNode DiscoverLegacy(bool isMovie, Dictionary<string, StringValues> query)
    {
        var genreIds = ParseInts(Get(query, "with_genres"), ',');
        var language = Language(Get(query, "with_original_language"));
        var page = PageNumber(query);

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

        return Page(results, page, matches.Length);
    }

    /// <summary>
    /// Answers a service slice's discover query from the synthetic bands.
    ///
    /// The band and the anime rule are read from the query's own genres, which
    /// is what makes the per-genre, per-genre-anime and any-genre-anime streams
    /// return different (and differently paged) results — exactly the
    /// distinction the slice plan depends on.
    /// </summary>
    private static JsonNode DiscoverService(
        bool isMovie,
        Dictionary<string, StringValues> query,
        int[] providers)
    {
        var serviceIndex = ServiceIndexFor(providers);
        var page = PageNumber(query);
        var genreIds = ParseInts(Get(query, "with_genres"), ',');
        var language = Language(Get(query, "with_original_language"));

        if (serviceIndex < 0 || genreIds.Length == 0)
        {
            return Page(new JsonArray(), page, 0);
        }

        var animation = CatalogClassification.AnimationGenreId;
        int[] bands;

        if (genreIds.Length > 1 && genreIds.Contains(animation))
        {
            // Animation + a quiz genre: that genre's anime, which is what the
            // per-genre anime stream asks for.
            bands = [genreIds.First(genreId => genreId != animation)];
        }
        else if (genreIds.Length == 1 && genreIds[0] == animation && language == CatalogClassification.JapaneseLanguage)
        {
            // Animation alone, Japanese only: anime across every band — the
            // any-genre stream, which is the only route to the animation band's
            // own anime.
            bands = [.. CatalogVocabulary.GenreIds];
        }
        else
        {
            bands = genreIds;
        }

        var matches = new List<(int Id, double Popularity)>();

        foreach (var bandGenreId in bands)
        {
            var band = BandIndex(bandGenreId);

            if (band < 0)
            {
                continue;
            }

            for (var index = 0; index < BandTitles; index++)
            {
                if (!Carries(serviceIndex, index))
                {
                    continue;
                }

                var anime = IsAnime(index);
                var titleGenres = GenresFor(bandGenreId, anime);

                if (!genreIds.All(titleGenres.Contains))
                {
                    continue;
                }

                if (language is not null && LanguageFor(index) != language)
                {
                    continue;
                }

                matches.Add((SyntheticId(isMovie, band, index), PopularityFor(band, index)));
            }
        }

        // Popularity descending, then id — the provider's own order for a
        // discover call, and the order the paging below has to honor so that
        // "the first forty" is a stable claim.
        matches.Sort((left, right) =>
        {
            var byPopularity = right.Popularity.CompareTo(left.Popularity);

            return byPopularity != 0 ? byPopularity : left.Id.CompareTo(right.Id);
        });

        var results = new JsonArray();

        foreach (var (id, _) in matches.Skip((page - 1) * PageSize).Take(PageSize))
        {
            results.Add(SyntheticItem(isMovie, id));
        }

        return Page(results, page, matches.Count);
    }

    /// <summary>Answers an enriched title query: detail, providers and videos in one body.</summary>
    private static JsonNode Detail(string path)
    {
        // "/3/movie/27205" or "/3/tv/1396"
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var isMovie = segments[^2] == "movie";
        var id = int.Parse(segments[^1]);

        return IsSynthetic(isMovie, id)
            ? SyntheticDetail(isMovie, id)
            : CatalogDetail(isMovie, id);
    }

    private static JsonNode CatalogDetail(bool isMovie, int id)
    {
        var title = Catalog.Single(entry => entry.Id == id && entry.IsMovie == isMovie);

        var providersByRegion = new JsonObject();

        foreach (var region in CatalogApiFactory.Regions)
        {
            if (Availability.GetValueOrDefault((id, region)) is not { } carries)
            {
                continue;
            }

            var buckets = new Dictionary<string, JsonArray>(StringComparer.Ordinal);

            foreach (var (providerId, type) in carries)
            {
                AddOffer(buckets, type, providerId, $"Provider {providerId}");
            }

            providersByRegion[region] = RegionEntry(
                $"https://www.themoviedb.org/{(isMovie ? "movie" : "tv")}/{id}/watch",
                buckets);
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

    /// <summary>
    /// A synthetic title's detail, including every service that carries it in
    /// every region.
    ///
    /// Availability is region-independent here — the handcrafted titles already
    /// prove the region lookup, Inception's badges differing between BR, US and
    /// GB — so a test about depth does not also have to reason about geography.
    /// </summary>
    private static JsonNode SyntheticDetail(bool isMovie, int id)
    {
        var (band, index) = SyntheticPosition(isMovie, id);
        var anime = IsAnime(index);
        var genreIds = GenresFor(CatalogVocabulary.GenreIds[band], anime);

        var providersByRegion = new JsonObject();

        foreach (var region in CatalogApiFactory.Regions)
        {
            var buckets = new Dictionary<string, JsonArray>(StringComparer.Ordinal);

            for (var serviceIndex = 0; serviceIndex < QuizServices.Length; serviceIndex++)
            {
                if (!Carries(serviceIndex, index))
                {
                    continue;
                }

                var (providerIds, _) = QuizServices[serviceIndex];

                AddOffer(
                    buckets,
                    MonetizationFor(index, serviceIndex),
                    providerIds[0],
                    ProviderName(providerIds[0]));

                // A second id for the same service, listed under a different
                // monetization. The catalog must fold both into one badge, or a
                // Netflix title would show Netflix twice.
                if (providerIds.Length > 1 && (index + serviceIndex) % 4 == 0)
                {
                    AddOffer(buckets, "ads", providerIds[^1], ProviderName(providerIds[^1]));
                }

                // One service's titles also carry an id the vocabulary cannot
                // name: the region-watch-page fallback's case.
                if (serviceIndex == UnknownProviderServiceIndex)
                {
                    AddOffer(buckets, "flatrate", UnknownProviderId, ProviderName(UnknownProviderId));
                }
            }

            providersByRegion[region] = RegionEntry(
                $"https://www.themoviedb.org/{(isMovie ? "movie" : "tv")}/{id}/watch?locale={region}",
                buckets);
        }

        return new JsonObject
        {
            ["id"] = id,
            ["title"] = isMovie ? SyntheticName(isMovie, id) : null,
            ["name"] = isMovie ? null : SyntheticName(isMovie, id),
            ["original_language"] = LanguageFor(index),
            ["overview"] = OverviewFor(band, index),
            ["poster_path"] = $"/synthetic-{id}.jpg",
            ["vote_average"] = RatingFor(index),
            ["vote_count"] = 1_000 + index,
            ["runtime"] = isMovie ? 90 + index % 30 : null,
            ["release_date"] = isMovie ? YearFor(index) : null,
            ["first_air_date"] = isMovie ? null : YearFor(index),
            ["genres"] = new JsonArray(genreIds.Select(genreId => (JsonNode)new JsonObject
            {
                ["id"] = genreId,
                ["name"] = $"Genre {genreId}",
            }).ToArray()),
            ["watch/providers"] = new JsonObject { ["results"] = providersByRegion },
            ["videos"] = new JsonObject { ["results"] = new JsonArray() },
        };
    }

    /// <summary>One synthetic discover tile, consistent with the same title's detail.</summary>
    private static JsonObject SyntheticItem(bool isMovie, int id)
    {
        var (band, index) = SyntheticPosition(isMovie, id);
        var genreIds = GenresFor(CatalogVocabulary.GenreIds[band], IsAnime(index));

        return new JsonObject
        {
            ["id"] = id,
            ["title"] = isMovie ? SyntheticName(isMovie, id) : null,
            ["name"] = isMovie ? null : SyntheticName(isMovie, id),
            ["genre_ids"] = new JsonArray(genreIds.Select(genreId => (JsonNode)genreId).ToArray()),
            ["original_language"] = LanguageFor(index),
            ["overview"] = OverviewFor(band, index),
            ["poster_path"] = $"/synthetic-{id}.jpg",
            ["popularity"] = PopularityFor(band, index),
            ["vote_average"] = RatingFor(index),
            ["vote_count"] = 1_000 + index,
            ["release_date"] = isMovie ? YearFor(index) : null,
            ["first_air_date"] = isMovie ? null : YearFor(index),
        };
    }

    /// <summary>One in five band titles is anime: animation and Japanese together.</summary>
    public static bool IsAnime(int titleIndex) => titleIndex % AnimeStride == 0;

    private static int[] GenresFor(int bandGenreId, bool anime) =>
        anime && bandGenreId != CatalogClassification.AnimationGenreId
            ? [bandGenreId, CatalogClassification.AnimationGenreId]
            : [bandGenreId];

    private static string LanguageFor(int titleIndex) =>
        IsAnime(titleIndex) ? CatalogClassification.JapaneseLanguage : "en";

    /// <summary>
    /// A band's popularity: higher bands are less popular, and inside a band
    /// popularity falls with the index. Distinct for every band title, so a
    /// popularity ordering is total and reproducible.
    /// </summary>
    private static double PopularityFor(int band, int titleIndex) =>
        10_000 - band * 100 - titleIndex;

    private static double RatingFor(int titleIndex) => 7.0 + titleIndex % 10 / 10.0;

    private static string YearFor(int titleIndex) => $"{2000 + titleIndex % 25}-01-01";

    private static string SyntheticName(bool isMovie, int id) =>
        $"Synthetic {(isMovie ? "Film" : "Series")} {id}";

    private static string OverviewFor(int band, int titleIndex) =>
        $"A synthetic title from band {band}, index {titleIndex}.";

    /// <summary>Which service a discover query names, or −1 when it names none of them.</summary>
    private static int ServiceIndexFor(int[] providers)
    {
        for (var index = 0; index < QuizServices.Length; index++)
        {
            if (QuizServices[index].ProviderIds.Intersect(providers).Any())
            {
                return index;
            }
        }

        return -1;
    }

    /// <summary>The monetization a service carries a band title under: a deterministic mix of all three.</summary>
    private static string MonetizationFor(int titleIndex, int serviceIndex) =>
        ((titleIndex + serviceIndex) % 13) switch
        {
            0 => "free",
            6 => "ads",
            _ => "flatrate",
        };

    private static string ProviderName(int providerId) =>
        ProviderNames.TryGetValue(providerId, out var name) ? name : $"Provider {providerId}";

    /// <summary>Adds one offer to a bucket, creating the bucket on first use.</summary>
    private static void AddOffer(
        Dictionary<string, JsonArray> buckets,
        string type,
        int providerId,
        string providerName)
    {
        if (!buckets.TryGetValue(type, out var bucket))
        {
            bucket = [];
            buckets[type] = bucket;
        }

        bucket.Add(new JsonObject
        {
            ["provider_id"] = providerId,
            ["provider_name"] = providerName,
            ["display_priority"] = 1,
        });
    }

    /// <summary>
    /// One region's watch-providers entry. Each bucket is attached exactly once,
    /// where it is built: a <see cref="JsonNode"/> holds a reference to its
    /// parent, so a bucket parked in one object and then assigned into another
    /// throws rather than copying — and an absent bucket is absent here too,
    /// which is how TMDB answers as well.
    /// </summary>
    private static JsonObject RegionEntry(string link, Dictionary<string, JsonArray> buckets)
    {
        var inRegion = new JsonObject { ["link"] = link };

        foreach (var (type, bucket) in buckets)
        {
            inRegion[type] = bucket;
        }

        return inRegion;
    }

    private static JsonObject Page(JsonArray results, int page, int totalResults) => new()
    {
        ["page"] = page,
        ["results"] = results,
        ["total_pages"] = (int)Math.Ceiling(totalResults / (double)PageSize),
        ["total_results"] = totalResults,
    };

    private static bool IsSynthetic(bool isMovie, int id) =>
        id >= (isMovie ? MovieIdBase : TvIdBase);

    private static (int Band, int Index) SyntheticPosition(bool isMovie, int id)
    {
        var offset = id - (isMovie ? MovieIdBase : TvIdBase);

        if (offset < 0 || offset >= CatalogVocabulary.GenreIds.Count * 1000)
        {
            throw new InvalidOperationException($"The stub does not know synthetic title {id}.");
        }

        return (offset / 1000, offset % 1000);
    }

    private static StringValues Get(Dictionary<string, StringValues> query, string key) =>
        query.TryGetValue(key, out var value) ? value : StringValues.Empty;

    private static string? Language(StringValues values) =>
        values.Count == 0 || string.IsNullOrEmpty(values.ToString()) ? null : values.ToString();

    private static int PageNumber(Dictionary<string, StringValues> query) =>
        query.TryGetValue("page", out var pages) && int.TryParse(pages.ToString(), out var page)
            ? Math.Max(1, page)
            : 1;

    private static int[] ParseInts(StringValues values, char separator) =>
        values.Count == 0 || string.IsNullOrEmpty(values.ToString())
            ? []
            : values.ToString()
                .Split(separator, StringSplitOptions.RemoveEmptyEntries)
                .Select(int.Parse)
                .ToArray();

    /// <summary>One entry in the stub's handcrafted catalog.</summary>
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

/// <summary>
/// Every line the test host logged, kept so a test can assert an absence.
///
/// A positive assertion about a log ("the slice was reported") belongs in the
/// implementation's own tests; what the catalog suites need here is the
/// negative one the constitution states as a rule: no credential and no title
/// data ever reaches a log line (FR-017).
/// </summary>
public sealed class RecordingLog
{
    private readonly ConcurrentQueue<string> _lines = new();

    public IReadOnlyList<string> Lines => [.. _lines];

    public void Add(string line) => _lines.Enqueue(line);

    /// <summary>Whether any recorded line contains <paramref name="text"/>.</summary>
    public bool Contains(string text) =>
        _lines.Any(line => line.Contains(text, StringComparison.Ordinal));
}

/// <summary>Adds <see cref="RecordingLog"/> to the host's logging pipeline.</summary>
public sealed class RecordingLoggerProvider(RecordingLog log) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new RecordingLogger(categoryName, log);

    public void Dispose()
    {
    }

    private sealed class RecordingLogger(string category, RecordingLog log) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            log.Add($"{logLevel}: {category}: {formatter(state, exception)}");
    }
}

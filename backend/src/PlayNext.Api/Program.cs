using System.IO.Compression;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using PlayNext.Api.Endpoints;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Domain;
using PlayNext.Infrastructure.Catalog;
using PlayNext.Infrastructure.Persistence;
using PlayNext.Infrastructure.Security;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Request limits
// ---------------------------------------------------------------------------

// Kestrel's default request line is 8 KB. The catalog's `ids` batch is a GET
// whose query string carries up to a thousand title ids at ~18 characters each,
// which is comfortably past that — and the failure it produces is a bare 414
// with no body, arriving long before the endpoint that could explain the limit
// is reached. 32 KB leaves the maximum batch room for encoding overhead while
// staying far below anything that would make a request line expensive to parse.
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestLineSize = 32 * 1024);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

// The account store is the only stateful dependency. Failing here rather than
// defaulting keeps a misconfigured environment from starting up and silently
// answering with empty accounts.
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Postgres is not configured. See specs/004-guest-auth-migration/quickstart.md for the user-secrets command.");

builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));

// ---------------------------------------------------------------------------
// Identity — password hashing and lockout are the framework's, not ours
// ---------------------------------------------------------------------------

// AddIdentityCore, not AddIdentity: this API authenticates with bearer tokens,
// so the cookie sign-in schemes AddIdentity would register are unwanted (and
// would compete with JwtBearer for the default scheme).
builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        // FR-010 / constitution: Identity's default PasswordHasher is PBKDF2
        // (Rfc2898 with HMAC-SHA256), so the algorithm is inherited rather than
        // configured — there is no setting here because there is no deviation.

        // FR-008: one account per email address. Identity normalizes the
        // comparison, so casing and surrounding whitespace do not create a
        // second account for the same address.
        options.User.RequireUniqueEmail = true;

        // No email verification in this milestone (spec Assumptions), so an
        // unconfirmed address must not block sign-in — a visitor who registers
        // is signed in immediately, having just proved they hold the session.
        options.SignIn.RequireConfirmedAccount = false;
        options.SignIn.RequireConfirmedEmail = false;

        // FR-011, research D10: five consecutive failures lock the account for
        // fifteen minutes. A successful sign-in clears the count — Identity
        // resets it, which is the behaviour the spec describes.
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.Lockout.AllowedForNewUsers = true;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddSignInManager();

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// The catalog credential (005). Checked here, at startup, for the same reason
// the connection string is: a server that cannot reach TMDB would otherwise
// start up and answer every deck with the empty state, which looks like an
// empty catalog rather than a missing key.
var tmdbApiKey = builder.Configuration["Tmdb:ApiKey"];

if (string.IsNullOrWhiteSpace(tmdbApiKey))
{
    throw new InvalidOperationException(
        "Tmdb:ApiKey is not configured. See specs/005-tmdb-catalog/quickstart.md for the user-secrets command.");
}

var signingKey = builder.Configuration["Jwt:SigningKey"]
    ?? throw new InvalidOperationException(
        "Jwt:SigningKey is not configured. See specs/004-guest-auth-migration/quickstart.md for the user-secrets command.");

// HMAC-SHA256 needs at least 256 bits of key material; a shorter secret would
// be silently accepted by the runtime and quietly weaken every token.
if (Encoding.UTF8.GetByteCount(signingKey) < 32)
{
    throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes (64 hex characters).");
}

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "playnext";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "playnext-app";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            ValidateLifetime = true,

            // The default is five minutes, which would let an expired access
            // token keep working long enough to matter. Thirty seconds absorbs
            // clock drift between the client and this host and nothing more.
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorization();

// ---------------------------------------------------------------------------
// CORS — an explicit allow-list, never a wildcard (constitution IV)
// ---------------------------------------------------------------------------

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:4200"];

builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(allowedOrigins)

    // Credentials are required: the refresh token is a cookie, and a browser
    // will not send or store it on a cross-origin response unless the server
    // names the exact origin *and* allows credentials. That combination is why
    // the origin list must be explicit — WithOrigins and AllowCredentials
    // cannot be combined with AllowAnyOrigin, by design.
    .AllowCredentials()
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddSingleton<RefreshCookiePolicy>();

// ---------------------------------------------------------------------------
// The application's own seams
// ---------------------------------------------------------------------------

// TimeProvider rather than DateTimeOffset.UtcNow: expiry, lockout remaining and
// the merge's timestamps are all read from the clock, and a use case that reads
// it through a seam can be tested at a fixed instant instead of only "now".
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<GoogleOptions>(builder.Configuration.GetSection(GoogleOptions.SectionName));
builder.Services.Configure<TmdbOptions>(builder.Configuration.GetSection(TmdbOptions.SectionName));
builder.Services.Configure<CatalogOptions>(builder.Configuration.GetSection(CatalogOptions.SectionName));

// Scoped: these hold a DbContext, which is per-request.
builder.Services.AddScoped<IAccountStore, IdentityAccountStore>();
builder.Services.AddScoped<IAccountStateRepository, AccountStateRepository>();
builder.Services.AddScoped<ISessionStore, SessionStore>();
builder.Services.AddScoped<AuthUseCases>();
builder.Services.AddScoped<StateUseCases>();

// ---------------------------------------------------------------------------
// The catalog (005)
// ---------------------------------------------------------------------------

// A region's catalog is the same for every visitor in it, so it is cached once
// and shared — the store and the refresher are process-wide state, not
// per-request state, and are registered accordingly.
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<ICatalogSnapshotStore, CatalogSnapshotStore>();
builder.Services.AddSingleton<ICatalogRefresher, CatalogRefresher>();

// Scoped, because a refresh writes through a DbContext and the request path
// reads through the store's cache. The refresher resolves this from a scope of
// its own rather than being handed one, which is what keeps a singleton from
// capturing a request's DbContext.
//
// Built by hand rather than by type, for the staleness bound: it is configured
// with the rest of the catalog options, which live in Infrastructure, and the
// Application layer is not allowed to know about them (constitution VII). This
// is where the two meet — the policy takes the value, not the options object.
builder.Services.AddScoped(services => new CatalogUseCases(
    services.GetRequiredService<ICatalogProvider>(),
    services.GetRequiredService<ICatalogSnapshotStore>(),
    services.GetRequiredService<ICatalogRefresher>(),
    services.GetRequiredService<TimeProvider>(),
    services.GetRequiredService<IOptions<TmdbOptions>>().Value.Staleness));

// The provider is a typed client: one long-lived HttpClient per process, with
// its connection pool reused, and its base address read from configuration so
// the whole catalog can be pointed at a stub in tests (research D18).
builder.Services
    .AddHttpClient<ICatalogProvider, TmdbClient>((services, client) =>
    {
        var tmdb = services.GetRequiredService<IOptions<TmdbOptions>>().Value;

        client.BaseAddress = tmdb.BaseAddress;

        // A pool of a few hundred calls should never take minutes; when it
        // does, the batch is failing slowly and the previous snapshot is the
        // better answer.
        client.Timeout = TimeSpan.FromSeconds(30);
    });

// ---------------------------------------------------------------------------
// The catalog (008) — versioned rows, per-service depth, runs, retention
// ---------------------------------------------------------------------------

// Stores are scoped because each holds a DbContext. The pool cache and the
// refresher are singletons because what they guard — one cached pool per
// version, one run per region — is a property of the process (research D8,
// D10), and a per-request copy would give every visitor a private opinion
// about it.
builder.Services.AddSingleton<ICatalogPoolCache, CatalogPoolCache>();
builder.Services.AddScoped<ICatalogVersionStore, CatalogVersionStore>();
builder.Services.AddScoped<ICatalogPoolReader, CatalogPoolReader>();
builder.Services.AddScoped<ICatalogRetentionStore, CatalogRetentionStore>();
builder.Services.AddScoped<ICatalogRefreshRunStore, CatalogRefreshRunStore>();
builder.Services.AddScoped<CatalogVocabularySeeder>();
builder.Services.AddSingleton<ICatalogRefreshLog, CatalogRefreshLog>();

// Built by hand for the same reason CatalogUseCases is: the policy is a value
// assembled from Infrastructure's options, so Application never learns what
// `Catalog:Source` or `Tmdb:Staleness` are called (constitution VII).
builder.Services.AddScoped(services => new CatalogQueryService(
    services.GetRequiredService<ICatalogSnapshotStore>(),
    services.GetRequiredService<ICatalogVersionStore>(),
    services.GetRequiredService<ICatalogPoolReader>(),
    services.GetRequiredService<ICatalogPoolCache>(),
    services.GetRequiredService<ICatalogRefresher>(),
    services.GetRequiredService<ICatalogRetentionStore>(),
    services.GetRequiredService<TimeProvider>(),
    new CatalogQueryPolicy(
        // Read per request: the switch is the rollback (FR-007, SC-005), and a
        // value captured at startup would be a rollback that needs a deployment
        // after all.
        CatalogSources.IsNormalized(
            services.GetRequiredService<IOptionsMonitor<CatalogOptions>>().CurrentValue.Source)
            ? CatalogSource.Normalized
            : CatalogSource.Snapshot,
        services.GetRequiredService<IOptions<TmdbOptions>>().Value.Staleness,
        CatalogRetention.Limit)));

builder.Services.AddScoped(services =>
{
    var tmdb = services.GetRequiredService<IOptions<TmdbOptions>>().Value;
    var catalog = services.GetRequiredService<IOptionsMonitor<CatalogOptions>>().CurrentValue;

    return new RefreshCatalogUseCase(
        services.GetRequiredService<ICatalogProvider>(),
        services.GetRequiredService<ICatalogVersionStore>(),
        services.GetRequiredService<ICatalogRefreshRunStore>(),
        services.GetRequiredService<ICatalogRetentionStore>(),
        services.GetRequiredService<ICatalogPoolCache>(),
        services.GetRequiredService<ICatalogRefreshLog>(),
        services.GetRequiredService<TimeProvider>(),
        new CatalogRefreshPolicy(
            new CatalogSlicePlanOptions(
                tmdb.MoviesPerGenre,
                tmdb.TvPerGenre,
                tmdb.AnimeQuota,
                tmdb.ServiceTitlesPerGenre,
                tmdb.MaxDiscoverPages),
            TimeSpan.FromMinutes(catalog.RefreshTimeoutMinutes),
            CatalogStartupMaintenance.BuildingMaxAge,
            CatalogStartupMaintenance.SupersededMaxAge));
});

builder.Services.AddScoped<MigrateCatalogUseCase>();
builder.Services.AddScoped<CatalogRetentionUseCase>();

// Two opt-in one-shot passes, both background services rather than startup
// work: a slow purge or a snapshot migration must not make the host look
// unhealthy, and neither failure is a reason to refuse every request.
builder.Services.AddHostedService<CatalogStartupMaintenance>();
builder.Services.AddHostedService<CatalogMigrationRunner>();

// Singletons: no state beyond immutable options. TokenService holds an options
// snapshot and a clock; GoogleTokenVerifier holds a configuration manager that
// caches Google's keys and rotates them on its own.
builder.Services.AddSingleton<ITokenService, TokenService>();

// Registered through a factory rather than by type: the verifier has a second,
// public constructor — the seam its unit tests use — and naming the intended
// one here means the container is never in a position to guess.
builder.Services.AddSingleton<IGoogleTokenVerifier>(services => new GoogleTokenVerifier(
    services.GetRequiredService<IOptions<GoogleOptions>>()));

// ---------------------------------------------------------------------------
// Logging — structured, and never carrying a payload
// ---------------------------------------------------------------------------

// The security standard is "no raw API keys or personal data in logs". The
// strongest way to honor it is to make the log stream structured and to never
// opt into body logging: nothing here logs request or response bodies, so
// passwords, tokens, and rating contents have no path into a log record.
// Anything logged deliberately goes through structured properties (request id,
// status, latency), which are queryable without being readable content.
builder.Logging.AddJsonConsole(options =>
{
    options.IncludeScopes = true;
    options.UseUtcTimestamp = true;
    options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
});

builder.Services.AddOpenApi();

// The catalog payload is the one large response this API serves — a region's
// pool is ~380 KB of JSON — and it is served to phones on mobile data
// (SC-002). Compressing it is the cheapest thing that can be done for that
// number, and it costs a line (research D3's tuning ladder names it second,
// after the pool quota).
//
// `EnableForHttps` is deliberate. Compression is off over TLS by default
// because of BREACH, which needs a response that mixes a secret with
// attacker-influenced input. This route is anonymous, reads no visitor data,
// and reflects nothing the caller sent, so there is no secret in it to leak —
// and the deployment terminates TLS in front of it.
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes;
});

// Both providers default to `Fastest`, and for this payload that is not a
// neutral choice: measured against the live provider, brotli at its default
// produced 180 KB where gzip produced 162 KB. Browsers offer `br` ahead of
// `gzip`, so the default would hand every modern browser the *larger* body.
// `Optimal` is the middle of the three levels — the pool is retrieved once and
// served many times, so the CPU is spent per response rather than per byte
// saved, and it must not become the reason the first card misses 300 ms.
builder.Services.Configure<BrotliCompressionProviderOptions>(
    options => options.Level = CompressionLevel.Optimal);
builder.Services.Configure<GzipCompressionProviderOptions>(
    options => options.Level = CompressionLevel.Optimal);

// ---------------------------------------------------------------------------
// The Angular app
// ---------------------------------------------------------------------------

// In production this process serves the PWA as well as the API, and that is not
// an incidental convenience — it is what keeps the two same-origin. The session
// refresh token is an httpOnly cookie scoped to /api/auth, so a second origin
// would make it a third-party cookie that Safari and Firefox refuse, and every
// signed-in visitor on those browsers would be logged out silently every
// fifteen minutes.
//
// Locally there is no wwwroot: `ng serve` serves the frontend on :4200 and
// proxies /api to here, so everything below is a no-op in Development.

// The files that must never be cached, because caching one pins a visitor to
// the build they first loaded. The service worker's own files are here for the
// same reason as the shell: a cached ngsw.json is a worker that never learns
// there is a new version to fetch.
string[] neverCached =
[
    "index.html",
    "ngsw.json",
    "ngsw-worker.js",
    "safety-worker.js",
    "worker-basic.min.js",
];

var staticFiles = new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var name = context.File.Name;

        // Decided by name rather than by extension, because the two cases that
        // matter most are both `.js`: a hashed `main-XXXXXXXX.js` can be cached
        // for a year (its name changes when its contents do) while
        // `ngsw-worker.js` must not be cached at all.
        //
        // What remains after those two lists is the output of the Angular
        // builder (hashed, so safe for a year) and the verbatim copies of
        // `public/` — icons, the manifest, the TMDB logo — which get an hour,
        // because those names do *not* change when their contents do and a year
        // would strand a replaced icon.
        context.Context.Response.Headers.CacheControl =
            neverCached.Contains(name)
                ? "no-cache"
                : name.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
                    || name.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
                    ? "public,max-age=31536000,immutable"
                    : "public,max-age=3600";
    },
};

var app = builder.Build();

// The catalog's vocabulary before anything can serve: every version write
// references a service or genre row, and an empty vocabulary would let a
// refresh store names it could never render. The upserts are by id and
// idempotent, which is what makes this safe — and cheap — on every start.
await using (var scope = app.Services.CreateAsyncScope())
{
    await scope.ServiceProvider
        .GetRequiredService<CatalogVocabularySeeder>()
        .SeedAsync(CancellationToken.None);
}

// Early, so it wraps every response the endpoints below produce.
app.UseResponseCompression();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
else
{
    // Development deliberately skips this: the frontend calls the API over
    // plain http on localhost, and redirecting to https would send every call
    // to a dev certificate no browser trusts.
    //
    // In production this only terminates because the host is told to trust the
    // proxy in front of it (ASPNETCORE_FORWARDEDHEADERS_ENABLED). App Service
    // ends TLS and forwards plain http, so without that the request looks
    // insecure here and this redirects to the same URL forever.
    app.UseHttpsRedirection();
}

app.UseStaticFiles(staticFiles);

// Order matters: CORS must run before authentication so a rejected preflight
// is answered by the CORS middleware rather than a 401 the browser cannot read.
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapStateEndpoints();
app.MapCatalogEndpoints();

// An API path that matched no endpoint is a 404 the caller can read, not the
// PWA's shell. This exists because the fallback below would otherwise answer it
// with index.html and a 200, which turns a typo in a fetch URL into an HTML
// parse error somewhere far from the typo.
//
// `Results.NotFound()` and not a JSON body: a 404 with no content is what every
// other unmatched route on this host returns, and an empty body is not worth
// inventing a contract for.
app.Map("/api/{**rest}", () => Results.NotFound());

// Everything else belongs to the Angular router, so a deep link like
// /watchlist/history — which only the client can route — returns the shell
// rather than a 404. Requests that look like files never reach here (the
// fallback's route constraint is `nonfile`), which is what keeps a missing
// asset a missing asset instead of a successful page load.
//
// The options are passed rather than using the single-argument overload,
// because that overload builds its own defaults: the shell would be served
// through this path without the cache policy above, and a browser would then be
// free to cache it heuristically — the one response that must never be stale.
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

/// <summary>
/// Exposed so the integration test project can drive the real host in-process
/// (WebApplicationFactory) rather than a hand-assembled copy of this wiring.
/// </summary>
public partial class Program;

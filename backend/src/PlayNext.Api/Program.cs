using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using PlayNext.Api.Endpoints;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Infrastructure.Persistence;
using PlayNext.Infrastructure.Security;

var builder = WebApplication.CreateBuilder(args);

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

// Scoped: these hold a DbContext, which is per-request.
builder.Services.AddScoped<IAccountStore, IdentityAccountStore>();
builder.Services.AddScoped<IAccountStateRepository, AccountStateRepository>();
builder.Services.AddScoped<ISessionStore, SessionStore>();
builder.Services.AddScoped<AuthUseCases>();
builder.Services.AddScoped<StateUseCases>();

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

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
else
{
    // Development deliberately skips this: the frontend calls the API over
    // plain http on localhost, and redirecting to https would send every call
    // to a dev certificate no browser trusts.
    app.UseHttpsRedirection();
}

// Order matters: CORS must run before authentication so a rejected preflight
// is answered by the CORS middleware rather than a 401 the browser cannot read.
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapStateEndpoints();

app.Run();

/// <summary>
/// Exposed so the integration test project can drive the real host in-process
/// (WebApplicationFactory) rather than a hand-assembled copy of this wiring.
/// </summary>
public partial class Program;

using System.Security.Cryptography;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PlayNext.Infrastructure.Security;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Unit tests for the security layer — no database, no network, no Google
/// account, so unlike the rest of this project they always run.
///
/// They live here because this is the only test project with Infrastructure in
/// its graph (plan.md defines three test projects, and the security types are
/// reachable through the API).
///
/// The audience test is the one worth having. Google's signature proves only
/// that Google signed the token — it says nothing about *whose* token it is.
/// Without the audience check, an ID token minted for any other application
/// would be accepted here as proof of identity: a real account-takeover path,
/// and one that no other test in this suite would notice.
/// </summary>
public class GoogleTokenVerifierTests
{
    private const string ClientId = "playnext-test.apps.googleusercontent.com";
    private const string GoogleIssuer = "https://accounts.google.com";

    /// <summary>A stand-in for Google's signing key. Real tokens never touch this; the point is that the key is local.</summary>
    private static readonly RsaSecurityKey GoogleKey = new(RSA.Create(2048));

    private static readonly RsaSecurityKey SomebodyElsesKey = new(RSA.Create(2048));

    private static GoogleTokenVerifier Verifier(string clientId = ClientId)
    {
        return new GoogleTokenVerifier(
            clientId,
            _ => Task.FromResult<IEnumerable<SecurityKey>>([GoogleKey]));
    }

    private static string MintToken(
        string issuer = GoogleIssuer,
        string audience = ClientId,
        DateTimeOffset? expires = null,
        object? emailVerified = null,
        SecurityKey? key = null,
        string? email = "visitor@example.com")
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            NotBefore = DateTime.UtcNow.AddMinutes(-1),
            IssuedAt = DateTime.UtcNow.AddMinutes(-1),
            Expires = (expires ?? DateTimeOffset.UtcNow.AddMinutes(5)).UtcDateTime,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = "google-sub-123",
                ["email"] = email!,
                ["email_verified"] = emailVerified ?? true,
            },
            SigningCredentials = new SigningCredentials(key ?? GoogleKey, SecurityAlgorithms.RsaSha256),
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    [Fact]
    public async Task A_token_Google_signed_for_this_app_yields_the_identity()
    {
        var identity = await Verifier().VerifyAsync(MintToken(), CancellationToken.None);

        Assert.NotNull(identity);
        Assert.Equal("google-sub-123", identity.Subject);
        Assert.Equal("visitor@example.com", identity.Email);
        Assert.True(identity.EmailVerified);
    }

    [Fact]
    public async Task A_token_minted_for_a_different_application_is_refused()
    {
        // The account-takeover guard: a valid Google signature for somebody
        // else's app must not identify anyone here.
        var token = MintToken(audience: "someone-elses-app.apps.googleusercontent.com");

        Assert.Null(await Verifier().VerifyAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task A_token_from_another_issuer_is_refused()
    {
        var token = MintToken(issuer: "https://accounts.evil.example");

        Assert.Null(await Verifier().VerifyAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task An_expired_token_is_refused()
    {
        var token = MintToken(expires: DateTimeOffset.UtcNow.AddMinutes(-5));

        Assert.Null(await Verifier().VerifyAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task A_token_signed_with_the_wrong_key_is_refused()
    {
        var token = MintToken(key: SomebodyElsesKey);

        Assert.Null(await Verifier().VerifyAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task An_unverified_email_is_reported_as_unverified()
    {
        // The verifier reports the fact; refusing to link on it is the use
        // case's decision (FR-009), tested in the application suite.
        var identity = await Verifier().VerifyAsync(MintToken(emailVerified: false), CancellationToken.None);

        Assert.NotNull(identity);
        Assert.False(identity.EmailVerified);
    }

    [Fact]
    public async Task A_string_valued_email_verified_claim_is_understood()
    {
        // Google sends a boolean in ID tokens but "true" as a string in other
        // token types; treating the string form as unverified would silently
        // block those sign-ins.
        var identity = await Verifier().VerifyAsync(MintToken(emailVerified: "true"), CancellationToken.None);

        Assert.NotNull(identity);
        Assert.True(identity.EmailVerified);
    }

    [Fact]
    public async Task An_unconfigured_client_id_switches_google_sign_in_off()
    {
        // Empty client ID is the state until T045 supplies real credentials.
        // It must read as "not signed in", not as an exception on the sign-in path.
        var verifier = Verifier(clientId: string.Empty);

        Assert.Null(await verifier.VerifyAsync(MintToken(), CancellationToken.None));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-jwt")]
    public async Task An_unusable_credential_is_refused(string credential)
    {
        Assert.Null(await Verifier().VerifyAsync(credential, CancellationToken.None));
    }
}

/// <summary>
/// The token service: what it signs, how long it lives, and that the stored
/// form of a refresh token is never the token itself.
/// </summary>
public class TokenServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 27, 12, 0, 0, TimeSpan.Zero);

    private static readonly JwtOptions Options = new()
    {
        SigningKey = new string('a', 64),
        Issuer = "playnext",
        Audience = "playnext-app",
    };

    private static TokenService Service() => new(Microsoft.Extensions.Options.Options.Create(Options), new FixedClock(Now));

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public void The_access_token_carries_the_user_id_and_the_issuer()
    {
        var userId = Guid.NewGuid();

        var token = new JsonWebTokenHandler().ReadJsonWebToken(Service().CreateAccessToken(userId, "visitor@example.com"));

        Assert.Equal(userId.ToString(), token.GetClaim("sub").Value);
        Assert.Equal("visitor@example.com", token.GetClaim("email").Value);
        Assert.Equal("playnext", token.Issuer);
        Assert.Contains("playnext-app", token.Audiences);
    }

    [Fact]
    public void The_access_token_expires_in_fifteen_minutes()
    {
        // The constitution's "short expiration times", pinned to the number.
        var token = new JsonWebTokenHandler().ReadJsonWebToken(Service().CreateAccessToken(Guid.NewGuid(), "v@example.com"));

        Assert.Equal(Now.AddMinutes(15).UtcDateTime, token.ValidTo);
    }

    [Fact]
    public void A_refresh_token_is_not_stored_as_itself()
    {
        var service = Service();

        var refresh = service.CreateRefreshToken();

        Assert.NotEqual(refresh.Value, refresh.Hash);
        Assert.Equal(refresh.Hash, service.HashRefreshToken(refresh.Value));
    }

    [Fact]
    public void A_refresh_token_is_high_entropy_and_url_safe()
    {
        // 256 bits, base64url — it has to survive a cookie without escaping, and
        // it must not be guessable from anything else the server knows.
        var refresh = Service().CreateRefreshToken();

        Assert.True(refresh.Value.Length >= 43, $"Expected at least 43 characters, got {refresh.Value.Length}.");
        Assert.DoesNotContain('+', refresh.Value);
        Assert.DoesNotContain('/', refresh.Value);
        Assert.DoesNotContain('=', refresh.Value);
    }

    [Fact]
    public void Two_refresh_tokens_are_never_the_same()
    {
        var service = Service();

        Assert.NotEqual(service.CreateRefreshToken().Value, service.CreateRefreshToken().Value);
    }

    [Fact]
    public void Hashing_the_same_token_twice_gives_the_same_hash()
    {
        // The lookup is an exact index hit, so this has to be deterministic.
        var service = Service();

        Assert.Equal(service.HashRefreshToken("a-token"), service.HashRefreshToken("a-token"));
    }
}

/// <summary>
/// The refresh cookie: httpOnly always, and the SameSite/Secure pair that the
/// environment can actually support. A browser silently drops a cookie whose
/// attributes it will not accept, so getting this wrong shows up as a session
/// that never persists rather than as an error.
/// </summary>
public class RefreshCookiePolicyTests
{
    private sealed class StubEnvironment(string environmentName) : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;

        public string ApplicationName { get; set; } = "PlayNext.Api";

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    private static Microsoft.AspNetCore.Http.CookieOptions CookieFor(string environment)
        => new RefreshCookiePolicy(new StubEnvironment(environment)).Create();

    [Fact]
    public void The_cookie_is_never_readable_by_script()
    {
        Assert.True(CookieFor("Development").HttpOnly);
        Assert.True(CookieFor("Production").HttpOnly);
    }

    [Fact]
    public void Locally_the_cookie_is_strict_over_plain_http()
    {
        var cookie = CookieFor("Development");

        Assert.Equal(Microsoft.AspNetCore.Http.SameSiteMode.Strict, cookie.SameSite);
        Assert.False(cookie.Secure);
    }

    [Fact]
    public void In_production_the_cookie_is_none_and_secure()
    {
        // The frontend and API are different Azure origins, so SameSite=Strict
        // would stop the cookie being sent at all; None without Secure is
        // rejected outright by browsers. Both are required, together.
        var cookie = CookieFor("Production");

        Assert.Equal(Microsoft.AspNetCore.Http.SameSiteMode.None, cookie.SameSite);
        Assert.True(cookie.Secure);
    }

    [Fact]
    public void Deleting_the_cookie_uses_the_same_attributes_it_was_set_with()
    {
        // Attributes that differ make it a different cookie: sign-out would
        // appear to succeed while the real cookie survived (SC-007).
        var policy = new RefreshCookiePolicy(new StubEnvironment("Development"));

        var set = policy.Create();
        var deleted = policy.CreateForDeletion();

        Assert.Equal(set.Path, deleted.Path);
        Assert.Equal(set.SameSite, deleted.SameSite);
        Assert.Equal(set.Secure, deleted.Secure);
        Assert.Equal(set.HttpOnly, deleted.HttpOnly);
        Assert.True(deleted.Expires < DateTimeOffset.UtcNow);
    }
}

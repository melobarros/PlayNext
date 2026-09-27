using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using PlayNext.Application.Interfaces;

namespace PlayNext.Infrastructure.Security;

/// <summary>
/// Google's OAuth client settings.
///
/// Only the client ID is here, and that is not an omission. In the popup flow
/// the research chose (D5), the browser obtains the ID token and this server
/// only has to *verify* it — which needs the audience (the client ID) and
/// Google's public keys, and nothing else. The client secret belongs to the
/// authorization-code exchange, a flow this app does not use, so it is not
/// configured and there is no secret to leak.
/// </summary>
public sealed class GoogleOptions
{
    /// <summary>The configuration section these bind from.</summary>
    public const string SectionName = "Google";

    /// <summary>
    /// The OAuth client ID. Public by design — Google intends it to ship in
    /// client code. Empty means Google sign-in is switched off, which is a
    /// supported state rather than a broken one.
    /// </summary>
    public string ClientId { get; set; } = string.Empty;
}

/// <summary>
/// Validates a Google ID token against Google's published keys (research D5).
/// </summary>
/// <remarks>
/// Signature, issuer, audience and expiry are all checked, and all four matter:
/// a valid signature alone proves only that *Google* signed it, so without the
/// audience check a token minted for any other application would be accepted
/// here. The audience is what makes it this app's token.
/// </remarks>
public sealed class GoogleTokenVerifier : IGoogleTokenVerifier
{
    private static readonly string[] ValidIssuers = ["https://accounts.google.com", "accounts.google.com"];

    private readonly string _clientId;
    private readonly Func<CancellationToken, Task<IEnumerable<SecurityKey>>> _signingKeys;

    /// <summary>The production wiring: keys fetched from Google, and cached and rotated by the handler.</summary>
    public GoogleTokenVerifier(IOptions<GoogleOptions> options)
        : this(options.Value.ClientId, FetchGoogleSigningKeys)
    {
    }

    /// <summary>
    /// The seam that makes this testable: keys are supplied rather than always
    /// fetched, so the whole validation path can be exercised against a locally
    /// generated key with no network and no Google account.
    /// </summary>
    public GoogleTokenVerifier(
        string clientId,
        Func<CancellationToken, Task<IEnumerable<SecurityKey>>> signingKeys)
    {
        _clientId = clientId;
        _signingKeys = signingKeys;
    }

    public async Task<GoogleIdentity?> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        // Not configured, or nothing to verify. Both mean "not signed in", and
        // neither is an error worth surfacing differently (FR-012 treats a
        // cancelled or unusable Google sign-in as an ordinary outcome).
        if (string.IsNullOrWhiteSpace(_clientId) || string.IsNullOrWhiteSpace(idToken))
        {
            return null;
        }

        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuers = ValidIssuers,
            ValidateAudience = true,
            ValidAudience = _clientId,
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = await _signingKeys(cancellationToken),
            ValidateLifetime = true,

            // Google's clock and this host's are not the same clock. A minute
            // absorbs the difference; it is not a licence for stale tokens.
            ClockSkew = TimeSpan.FromMinutes(1),
        };

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(idToken, parameters);

        if (!result.IsValid)
        {
            return null;
        }

        var claims = result.ClaimsIdentity;

        var email = claims.FindFirst("email")?.Value;
        var subject = claims.FindFirst("sub")?.Value;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(subject))
        {
            return null;
        }

        return new GoogleIdentity(subject, email, EmailIsVerified(claims));
    }

    /// <summary>
    /// Google sends <c>email_verified</c> as a boolean in an ID token but as the
    /// string <c>"true"</c> in some other token types, so both are accepted.
    /// Anything else — absent, malformed, <c>"false"</c> — reads as unverified,
    /// because the failure mode of guessing wrong here is account takeover.
    /// </summary>
    private static bool EmailIsVerified(System.Security.Claims.ClaimsIdentity claims)
    {
        var claim = claims.FindFirst("email_verified")?.Value;

        return bool.TryParse(claim, out var verified) && verified;
    }

    private static async Task<IEnumerable<SecurityKey>> FetchGoogleSigningKeys(CancellationToken cancellationToken)
    {
        var configuration = await GoogleConfiguration.GetConfigurationAsync(cancellationToken);

        return configuration.SigningKeys;
    }

    /// <summary>
    /// Google's OpenID configuration, fetched once and refreshed as the keys
    /// rotate. The handler owns the caching and the concurrency; doing it by
    /// hand would mean re-implementing key rotation, and getting a rotation
    /// wrong means rejecting every sign-in until the process restarts.
    /// </summary>
    private static readonly ConfigurationManager<OpenIdConnectConfiguration> GoogleConfiguration = new(
        "https://accounts.google.com/.well-known/openid-configuration",
        new OpenIdConnectConfigurationRetriever(),
        new HttpDocumentRetriever { RequireHttps = true });
}

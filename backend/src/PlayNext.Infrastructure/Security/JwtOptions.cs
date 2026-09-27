namespace PlayNext.Infrastructure.Security;

/// <summary>
/// The signing configuration, bound from the <c>Jwt</c> configuration section.
///
/// Held as an options object rather than read from <c>IConfiguration</c> at each
/// use so the signing key is resolved once, at startup, and a missing key is a
/// startup failure rather than a surprise on the first sign-in.
/// </summary>
public sealed class JwtOptions
{
    /// <summary>The configuration section these bind from.</summary>
    public const string SectionName = "Jwt";

    /// <summary>
    /// The HMAC-SHA256 key. Never leaves the server — this and the Google client
    /// secret are the two values the constitution keeps out of client code.
    /// </summary>
    public string SigningKey { get; set; } = string.Empty;

    /// <summary>Token issuer, validated on every request.</summary>
    public string Issuer { get; set; } = "playnext";

    /// <summary>Token audience, validated on every request.</summary>
    public string Audience { get; set; } = "playnext-app";

    /// <summary>
    /// How long an access token lives (research D6: 15 minutes).
    ///
    /// Short because it cannot be revoked — it is a bearer token, valid until it
    /// expires — so the window in which a stolen one is useful is exactly this.
    /// The refresh token, which *is* revocable, carries the long session.
    /// </summary>
    public TimeSpan AccessTokenLifetime { get; set; } = TimeSpan.FromMinutes(15);
}

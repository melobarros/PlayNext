using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PlayNext.Application.Interfaces;

namespace PlayNext.Infrastructure.Security;

/// <summary>
/// Mints the two credentials a session needs, and hashes the one that gets
/// stored (research D6).
/// </summary>
public sealed class TokenService(IOptions<JwtOptions> options, TimeProvider clock) : ITokenService
{
    private readonly JwtOptions _options = options.Value;

    /// <summary>
    /// 15 minutes, HMAC-SHA256 (constitution: short expiration times). The token
    /// carries the user id as <c>sub</c> — the only claim anything reads — and
    /// nothing else, so a leaked token reveals no more than the id it already is.
    /// </summary>
    public string CreateAccessToken(Guid userId, string email)
    {
        var now = clock.GetUtcNow();

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = now.Add(_options.AccessTokenLifetime).UtcDateTime,
            Subject = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, email),
            ]),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey)),
                SecurityAlgorithms.HmacSha256),
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    /// <summary>
    /// 256 bits from the cryptographic RNG, url-safe so it survives a cookie
    /// without escaping. Not derived from anything about the user: a refresh
    /// token is a lookup key, and it should be worthless to anyone who cannot
    /// also present it.
    /// </summary>
    public RefreshToken CreateRefreshToken()
    {
        var value = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

        return new RefreshToken(value, HashRefreshToken(value));
    }

    /// <summary>
    /// SHA-256, hex-encoded, unsalted.
    ///
    /// Unsalted is correct here and would be wrong for a password: the input is
    /// 256 bits of randomness, so there is no dictionary to run and nothing for
    /// a salt to defend against, while the lookup has to be one exact index hit.
    /// </summary>
    public string HashRefreshToken(string refreshToken)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken)));
    }
}

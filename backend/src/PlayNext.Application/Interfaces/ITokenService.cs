namespace PlayNext.Application.Interfaces;

/// <summary>
/// A freshly minted refresh token: the value to hand the client, and the hash
/// to keep. They travel together exactly once, and only the hash outlives the
/// response.
/// </summary>
public sealed record RefreshToken(string Value, string Hash);

/// <summary>
/// Mints and hashes credentials.
///
/// Split from <see cref="ISessionStore"/> because the two have different
/// reasons to change: this is cryptography, the store is persistence. Keeping
/// them together would mean a test of the signing key needed a database.
/// </summary>
public interface ITokenService
{
    /// <summary>
    /// Signs a short-lived access token for the user (15 minutes, HMAC-SHA256 —
    /// research D6). The client keeps it in memory only.
    /// </summary>
    string CreateAccessToken(Guid userId, string email);

    /// <summary>Generates a new refresh token: 256 bits of randomness, plus its stored hash.</summary>
    RefreshToken CreateRefreshToken();

    /// <summary>
    /// Hashes a refresh token for lookup. Deterministic and unsalted by design —
    /// it is a 256-bit random value, not a password, so there is nothing to
    /// brute-force, and the lookup has to be an exact index hit.
    /// </summary>
    string HashRefreshToken(string refreshToken);
}

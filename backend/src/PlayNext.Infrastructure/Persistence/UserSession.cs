namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// One refresh token issued to one device (research D6).
///
/// Only the SHA-256 hash of the token is stored. A leaked database dump
/// therefore yields no usable credentials — the raw token exists in exactly two
/// places, the client's httpOnly cookie and the response that set it, and
/// nowhere on the server.
///
/// A row is revoked rather than deleted, so <see cref="RevokedAt"/> is the
/// record of when a session ended — which is also what makes "password change
/// kills every other session" (FR-014) auditable rather than merely effective.
/// </summary>
public class UserSession
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public ApplicationUser? User { get; set; }

    /// <summary>SHA-256 of the refresh token, hex-encoded. Never the token itself.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// Slides to now + 30 days on each refresh. FR-015 is 30 days <i>without
    /// activity</i>, so the window moves forward each time the device actually
    /// uses the session; it is not a fixed 30 days from sign-in.
    /// </summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Set on sign-out and on password change — both invalidate sessions (FR-013/FR-014).</summary>
    public DateTimeOffset? RevokedAt { get; set; }
}

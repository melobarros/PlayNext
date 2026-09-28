namespace PlayNext.Application.Interfaces;

/// <summary>
/// An issued refresh token, as the store knows it. Deliberately does not carry
/// the token: the server never has it, only its hash.
/// </summary>
public sealed record SessionRecord(Guid Id, Guid UserId, DateTimeOffset ExpiresAt);

/// <summary>
/// Where refresh tokens live (research D6).
///
/// The interface deals in hashes throughout — there is no method that takes a
/// raw token, because there is no code path that should ever hold one after it
/// has been sent to the client.
/// </summary>
public interface ISessionStore
{
    /// <summary>Records a newly issued refresh token.</summary>
    Task StoreAsync(
        Guid userId,
        string tokenHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken);

    /// <summary>
    /// The live session for a token hash, or <c>null</c>. A revoked or expired
    /// session is not live, so callers cannot accidentally accept one.
    /// </summary>
    Task<SessionRecord?> FindLiveAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>Slides a session's expiry forward — activity extends the 30-day window (FR-015).</summary>
    Task ExtendAsync(Guid sessionId, DateTimeOffset expiresAt, CancellationToken cancellationToken);

    /// <summary>Revokes one session (sign-out).</summary>
    Task RevokeAsync(Guid sessionId, DateTimeOffset revokedAt, CancellationToken cancellationToken);

    /// <summary>
    /// Revokes every session for a user. Used by password change, where the
    /// point is that the old credential stops working everywhere at once
    /// (FR-014) — including on the device that changed it.
    /// </summary>
    Task RevokeAllForUserAsync(Guid userId, DateTimeOffset revokedAt, CancellationToken cancellationToken);
}

using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Interfaces;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Infrastructure.Security;

/// <summary>
/// Refresh tokens, in PostgreSQL (research D6).
///
/// Rows are looked up by hash and never by value — the raw token does not exist
/// on this side at all, which is the point: a dump of this table is a list of
/// useless hashes.
///
/// Revocation sets <c>RevokedAt</c> rather than deleting, so "which sessions
/// existed and when they ended" survives, and a revoked row can never be
/// mistaken for one that was never issued.
/// </summary>
public sealed class SessionStore(AppDbContext db, TimeProvider clock) : ISessionStore
{
    public async Task StoreAsync(
        Guid userId,
        string tokenHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        db.Sessions.Add(new UserSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = tokenHash,
            CreatedAt = clock.GetUtcNow(),
            ExpiresAt = expiresAt,
        });

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// A session is live only if it is unrevoked *and* unexpired, and both are
    /// checked in the query — a caller cannot be handed a session it then has to
    /// remember to re-check.
    /// </summary>
    public async Task<SessionRecord?> FindLiveAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var session = await db.Sessions
            .AsNoTracking()
            .FirstOrDefaultAsync(
                candidate => candidate.TokenHash == tokenHash
                    && candidate.RevokedAt == null
                    && candidate.ExpiresAt > now,
                cancellationToken);

        return session is null
            ? null
            : new SessionRecord(session.Id, session.UserId, session.ExpiresAt);
    }

    /// <summary>
    /// Slides the expiry forward. FR-015 is 30 days <i>without activity</i>, so
    /// using a session is what keeps it — this is the call that implements the
    /// "without activity" half.
    /// </summary>
    public async Task ExtendAsync(Guid sessionId, DateTimeOffset expiresAt, CancellationToken cancellationToken)
    {
        await db.Sessions
            .Where(session => session.Id == sessionId)
            .ExecuteUpdateAsync(
                update => update.SetProperty(session => session.ExpiresAt, expiresAt),
                cancellationToken);
    }

    public async Task RevokeAsync(Guid sessionId, DateTimeOffset revokedAt, CancellationToken cancellationToken)
    {
        await db.Sessions
            .Where(session => session.Id == sessionId)
            .ExecuteUpdateAsync(
                update => update.SetProperty(session => session.RevokedAt, revokedAt),
                cancellationToken);
    }

    /// <summary>
    /// Revokes every live session for a user — FR-014's "password change applies
    /// everywhere", including the device that made the change.
    /// </summary>
    public async Task RevokeAllForUserAsync(Guid userId, DateTimeOffset revokedAt, CancellationToken cancellationToken)
    {
        await db.Sessions
            .Where(session => session.UserId == userId && session.RevokedAt == null)
            .ExecuteUpdateAsync(
                update => update.SetProperty(session => session.RevokedAt, revokedAt),
                cancellationToken);
    }
}

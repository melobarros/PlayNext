namespace PlayNext.Application.Interfaces;

/// <summary>
/// A best-effort ceiling on intake traffic per session (contracts/
/// recommendation-events.md §429).
///
/// It is not a security control: the session id is client-generated, so a
/// client that rotates it starts a new window. Its job is to stop one broken
/// or looping tab from spending the server's capacity; the hard bounds are the
/// per-request limits and the body ceiling.
/// </summary>
public interface IRecommendationIntakeLimiter
{
    /// <summary>
    /// Reserves room for <paramref name="eventCount"/> events in
    /// <paramref name="sessionId"/>'s current window.
    /// </summary>
    /// <param name="retryAfterSeconds">
    /// When refused, the number of seconds until the window resets. Zero when
    /// the request was admitted.
    /// </param>
    /// <returns>Whether the request may proceed.</returns>
    bool TryAcquire(string sessionId, int eventCount, DateTimeOffset now, out int retryAfterSeconds);
}

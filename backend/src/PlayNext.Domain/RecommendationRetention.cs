namespace PlayNext.Domain;

/// <summary>
/// The behavioral-event retention rule (FR-018, research D14).
///
/// Ninety days is the product's promise, chosen on 2026-10-24: enough to compare
/// ranking changes across a quarter, no longer than the product can justify.
/// The rule is pure so the boundary can be settled without a database, and it is
/// expressed against the server's receipt time — a client with a wrong clock
/// must not be able to keep its own events alive past the window.
/// </summary>
public static class RecommendationRetention
{
    /// <summary>The window: ninety days from receipt to deletion.</summary>
    public static readonly TimeSpan Limit = TimeSpan.FromDays(90);

    /// <summary>The oldest receipt time that may still be stored at <paramref name="now"/>.</summary>
    public static DateTimeOffset Cutoff(DateTimeOffset now) => now - Limit;

    /// <summary>
    /// Whether an event received at <paramref name="receivedAt"/> has aged out.
    /// Strictly before the cutoff, so an event exactly at the boundary is kept:
    /// the rule is "older than ninety days", not "ninety days old".
    /// </summary>
    public static bool IsExpired(DateTimeOffset receivedAt, DateTimeOffset now) =>
        receivedAt < Cutoff(now);
}

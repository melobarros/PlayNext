using System.Collections.Concurrent;
using PlayNext.Application.Interfaces;

namespace PlayNext.Application.UseCases;

/// <summary>
/// The per-session intake ceiling: twenty requests and six hundred events per
/// minute (contracts/recommendation-events.md §429, research D9).
///
/// Not a security control, and deliberately not implemented as one. The session
/// id is a random value the client mints and keeps in tab storage, so anyone
/// who cares to can start a fresh window by discarding it. What this stops is
/// the accident rather than the attacker: one tab whose flush timer has gone
/// into a loop, or a client retrying a batch it believes failed, cannot spend
/// the server's write capacity or fill the table with one session's replay.
///
/// **Fixed windows, kept per session in memory.** A fixed window is the whole
/// design: the client is told a retry-after in whole seconds, and a sliding
/// window would make that number keep moving as the client waits. The state is
/// in-process, so a restart forgets every window — which is the right failure
/// for a throttle this coarse, and the reason it must never be described as a
/// quota.
///
/// **Refused requests consume nothing.** A refused request that still counted
/// against the window would extend the client's own lockout each time it
/// retried, and the retry-after already handed out would stop being true.
/// </summary>
public sealed class RecommendationIntakeLimiter : IRecommendationIntakeLimiter
{
    /// <summary>Flushes admitted per session per window.</summary>
    public const int MaxRequestsPerWindow = 20;

    /// <summary>Impressions plus actions admitted per session per window.</summary>
    public const int MaxEventsPerWindow = 600;

    /// <summary>The length of one fixed window.</summary>
    public static readonly TimeSpan WindowLength = TimeSpan.FromMinutes(1);

    /// <summary>
    /// How many calls pass between sweeps of the expired windows.
    ///
    /// A sweep is O(sessions), so it does not run per call on a busy server.
    /// The cost of waiting is bounded memory, never correctness: an expired
    /// window is reset on its next touch whether or not a sweep has found it.
    /// </summary>
    private const int CallsBetweenSweeps = 1024;

    private readonly ConcurrentDictionary<string, Window> _windows = new(StringComparer.Ordinal);

    private int _callsSinceSweep;

    public bool TryAcquire(
        string sessionId,
        int eventCount,
        DateTimeOffset now,
        out int retryAfterSeconds)
    {
        MaybeSweep(now);

        // Unreachable from a well-formed client — the per-request limits are
        // lower than this — but a window must never admit more than it can
        // hold, whatever it is asked for.
        if (eventCount > MaxEventsPerWindow)
        {
            retryAfterSeconds = (int)Math.Ceiling(WindowLength.TotalSeconds);
            return false;
        }

        var window = _windows.GetOrAdd(sessionId, static _ => new Window());

        // The dictionary is concurrent; the counters inside one window are not.
        // Contention is one session's own flushes at most, so a plain lock is
        // the honest tool here rather than per-field interlocked arithmetic
        // that could admit a request on a half-updated window.
        lock (window)
        {
            if (window.Start == default || now - window.Start >= WindowLength)
            {
                window.Start = now;
                window.Requests = 0;
                window.Events = 0;
            }

            if (window.Requests >= MaxRequestsPerWindow
                || window.Events + eventCount > MaxEventsPerWindow)
            {
                retryAfterSeconds = RetryAfter(window, now);
                return false;
            }

            window.Requests++;
            window.Events += eventCount;
            retryAfterSeconds = 0;
            return true;
        }
    }

    /// <summary>
    /// Whole seconds until the window resets, never zero.
    ///
    /// Rounded up because a client that woke exactly on the tick would be
    /// refused and would need a second retry for no reason; floored at one
    /// because a retry-after of zero reads as "retry now" and is precisely the
    /// loop this class exists to break.
    /// </summary>
    private static int RetryAfter(Window window, DateTimeOffset now)
    {
        var remaining = window.Start + WindowLength - now;
        return Math.Max(1, (int)Math.Ceiling(remaining.TotalSeconds));
    }

    private void MaybeSweep(DateTimeOffset now)
    {
        if (Interlocked.Increment(ref _callsSinceSweep) < CallsBetweenSweeps) return;

        Interlocked.Exchange(ref _callsSinceSweep, 0);

        foreach (var (sessionId, window) in _windows)
        {
            DateTimeOffset start;
            lock (window)
            {
                start = window.Start;
            }

            // Only windows that are already over. Removing one that is still
            // live would hand its session a fresh budget; removing an expired
            // one is what its next request would have done anyway.
            if (start != default && now - start >= WindowLength && !_windows.TryRemove(sessionId, out _))
            {
                // Another caller is touching it; it will be swept next time.
            }
        }
    }

    private sealed class Window
    {
        public DateTimeOffset Start { get; set; }

        public int Requests { get; set; }

        public int Events { get; set; }
    }
}

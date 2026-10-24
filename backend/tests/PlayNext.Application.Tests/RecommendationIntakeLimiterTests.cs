using PlayNext.Application.UseCases;

namespace PlayNext.Application.Tests;

/// <summary>
/// The per-session intake ceiling (contracts/recommendation-events.md §429).
///
/// This is deliberately not a security control — the session id is
/// client-generated and a rotating client starts a new window. What it must do
/// is stop one tab that has gone into a loop from spending the server's
/// capacity, and it must do it without ever letting a legitimate flush through
/// twice or refusing one that fits. The boundaries are asserted exactly.
/// </summary>
public class RecommendationIntakeLimiterTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 24, 18, 0, 0, TimeSpan.Zero);

    [Fact]
    public void An_admitted_request_reports_no_retry_after()
    {
        var limiter = new RecommendationIntakeLimiter();

        Assert.True(limiter.TryAcquire("session", 1, Start, out var retryAfter));

        Assert.Equal(0, retryAfter);
    }

    [Fact]
    public void Twenty_requests_in_one_window_are_allowed_and_the_twenty_first_is_not()
    {
        var limiter = new RecommendationIntakeLimiter();

        for (var i = 0; i < 20; i++)
        {
            Assert.True(limiter.TryAcquire("session", 1, Start.AddSeconds(i), out _));
        }

        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(20), out _));
    }

    [Fact]
    public void Six_hundred_events_are_allowed_and_one_more_is_not()
    {
        var limiter = new RecommendationIntakeLimiter();

        Assert.True(limiter.TryAcquire("session", 600, Start, out _));
        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(1), out _));
    }

    [Fact]
    public void A_batch_larger_than_the_ceiling_is_refused_even_in_an_empty_window()
    {
        // The per-request limits make this unreachable from a well-formed
        // client; the limiter must still not admit a window it cannot fit.
        var limiter = new RecommendationIntakeLimiter();

        Assert.False(limiter.TryAcquire("session", 601, Start, out _));
    }

    [Fact]
    public void The_request_count_and_the_event_count_are_separate_ceilings()
    {
        var limiter = new RecommendationIntakeLimiter();

        // 30 events a request, twenty requests: 600 events exactly, and the
        // request ceiling is what refuses the next one.
        for (var i = 0; i < 20; i++)
        {
            Assert.True(limiter.TryAcquire("session", 30, Start.AddSeconds(i), out _));
        }

        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(20), out _));
    }

    [Fact]
    public void The_window_resets_after_one_minute()
    {
        var limiter = new RecommendationIntakeLimiter();

        for (var i = 0; i < 20; i++)
        {
            Assert.True(limiter.TryAcquire("session", 1, Start, out _));
        }

        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(59), out _));
        Assert.True(limiter.TryAcquire("session", 1, Start.AddSeconds(60), out _));
    }

    [Fact]
    public void A_reset_window_starts_its_event_budget_over()
    {
        var limiter = new RecommendationIntakeLimiter();

        Assert.True(limiter.TryAcquire("session", 600, Start, out _));
        Assert.True(limiter.TryAcquire("session", 600, Start.AddMinutes(1), out _));
    }

    [Fact]
    public void The_retry_after_counts_the_seconds_left_in_the_window()
    {
        var limiter = new RecommendationIntakeLimiter();

        for (var i = 0; i < 20; i++)
        {
            limiter.TryAcquire("session", 1, Start, out _);
        }

        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(45), out var retryAfter));

        // The client is told to wait, not to give up: fifteen seconds is what
        // is actually left, rounded up so it cannot wake up one tick early.
        Assert.Equal(15, retryAfter);
    }

    [Fact]
    public void The_retry_after_is_never_zero()
    {
        var limiter = new RecommendationIntakeLimiter();

        for (var i = 0; i < 20; i++)
        {
            limiter.TryAcquire("session", 1, Start, out _);
        }

        // Refused on the last tick of the window: a zero would read as "retry
        // immediately" and invite exactly the loop the limiter exists to stop.
        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(59.5), out var retryAfter));
        Assert.True(retryAfter >= 1);
    }

    [Fact]
    public void Sessions_do_not_share_a_window()
    {
        var limiter = new RecommendationIntakeLimiter();

        for (var i = 0; i < 20; i++)
        {
            Assert.True(limiter.TryAcquire("first", 1, Start, out _));
        }

        Assert.False(limiter.TryAcquire("first", 1, Start, out _));
        Assert.True(limiter.TryAcquire("second", 1, Start, out _));
    }

    [Fact]
    public void A_refused_request_does_not_consume_the_window()
    {
        // Otherwise a client that keeps retrying extends its own lockout, and
        // the retry-after it was given stops being true.
        var limiter = new RecommendationIntakeLimiter();

        Assert.True(limiter.TryAcquire("session", 600, Start, out _));
        Assert.False(limiter.TryAcquire("session", 1, Start.AddSeconds(1), out _));

        Assert.True(limiter.TryAcquire("session", 1, Start.AddMinutes(1), out _));
    }
}

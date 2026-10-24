using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PlayNext.Application.UseCases;

namespace PlayNext.Infrastructure.Telemetry;

/// <summary>
/// The 90-day purge, on a clock (T058, FR-018, research D14).
///
/// **A pass at start, then once a day.** The API is hosted scale-to-zero, so a
/// timer that only runs while the process stays warm would miss exactly the idle
/// periods in which events age out; process start is the one clock this host
/// reliably has, which is why it is also when the catalog maintains itself.
///
/// **A failure is logged, not raised.** Retention is a promise best met
/// eventually: a database that is away at 03:00 should not take the API down,
/// and the next pass is a day away with the same rows still waiting. The catch
/// is per pass, so one bad night does not stop the service.
///
/// **Nothing about an event is logged.** A purge failure's message can carry the
/// SQL that failed, and the SQL carries parameter values — session ids, title
/// ids. So only the exception's type and message are recorded; the exception
/// object itself is not passed to the logger, because its stack is not worth a
/// chance of a value riding along.
/// </summary>
public sealed class RecommendationRetentionService(
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<RecommendationRetentionService> logger) : BackgroundService
{
    /// <summary>Frequent enough to keep the window honest, rare enough to be free.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, time);

        try
        {
            do
            {
                await PurgeOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down; the next start runs the pass again.
        }
    }

    private async Task PurgeOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();

            var deleted = await scope.ServiceProvider
                .GetRequiredService<PurgeRecommendationEventsUseCase>()
                .PurgeAsync(stoppingToken);

            if (deleted > 0)
            {
                logger.LogInformation(
                    "Purged {Deleted} recommendation events past the retention window.",
                    deleted);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The pass was cut short by shutdown. Rethrow so the loop ends
            // rather than starting another pass against a closing host.
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                "Recommendation retention purge failed ({Type}: {Message}). Events stay until the next pass.",
                exception.GetType().Name,
                exception.Message);
        }
    }
}

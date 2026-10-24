using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The catalog's startup pass (FR-015, research D5/D6): lifecycle cleanup, the
/// abandoned-run sweep, and a retention purge for every region that has a
/// version.
///
/// It exists because the API is hosted scale-to-zero: a timer that runs while
/// the app is warm would not run during the idle periods where a stale building
/// version or an expired row is most likely to be waiting. Process start is the
/// one clock this host reliably has, and every start is safe — each operation is
/// idempotent and scoped to what is already old.
///
/// It is a background service rather than part of the startup path so a slow
/// purge cannot delay readiness; a maintenance failure never stops the app.
/// </summary>
public sealed class CatalogStartupMaintenance(
    IServiceScopeFactory scopes,
    IOptions<CatalogOptions> options,
    TimeProvider time,
    ILogger<CatalogStartupMaintenance> logger) : BackgroundService
{
    /// <summary>
    /// A build older than this never finished, whatever happened to its
    /// process; the partial unique index would otherwise block every later
    /// build for the region.
    ///
    /// Public because the refresh's own cleanup step uses the same bound: two
    /// different ages for "abandoned" would be two different policies wearing
    /// one name.
    /// </summary>
    public static readonly TimeSpan BuildingMaxAge = TimeSpan.FromHours(2);

    /// <summary>A superseded version is kept one day as an operator's fallback, then deleted.</summary>
    public static readonly TimeSpan SupersededMaxAge = TimeSpan.FromDays(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var services = scope.ServiceProvider;

            var now = time.GetUtcNow();

            await services.GetRequiredService<ICatalogVersionStore>()
                .CleanupAsync(now, BuildingMaxAge, SupersededMaxAge, stoppingToken);

            await services.GetRequiredService<ICatalogRefreshRunStore>()
                .AbandonStaleAsync(
                    now - TimeSpan.FromMinutes(options.Value.RefreshTimeoutMinutes),
                    stoppingToken);

            var db = services.GetRequiredService<AppDbContext>();

            var regions = await db.CatalogVersions
                .AsNoTracking()
                .Select(version => version.Region)
                .Distinct()
                .ToListAsync(stoppingToken);

            var retention = services.GetRequiredService<CatalogRetentionUseCase>();

            foreach (var region in regions)
            {
                await retention.PurgeAsync(region, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down; the next start runs the pass again.
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Catalog startup maintenance failed; the catalog is untouched.");
        }
    }
}

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The opt-in one-shot migration from the stored snapshot to a normalized
/// version (research D6), gated by <c>Catalog:Migration:Enabled</c>.
///
/// It runs in the background rather than in the startup path: the migration
/// writes a whole catalog per region, and blocking readiness on it would make a
/// rollback deploy look unhealthy for as long as the copy takes. Every region
/// with a readable, in-retention snapshot is attempted; one region's failure is
/// logged and does not stop the others.
///
/// It never deletes the snapshot and never touches a user row — the snapshot is
/// the rollback path, and the identity rows the migration relies on are created
/// by the schema migration, not here.
/// </summary>
public sealed class CatalogMigrationRunner(
    IServiceScopeFactory scopes,
    IOptionsMonitor<CatalogOptions> options,
    ILogger<CatalogMigrationRunner> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.CurrentValue.Migration.Enabled)
        {
            return;
        }

        IReadOnlyList<string> regions;

        using (var scope = scopes.CreateScope())
        {
            regions = await scope.ServiceProvider
                .GetRequiredService<ICatalogSnapshotStore>()
                .ListRegionsAsync(stoppingToken);
        }

        foreach (var region in regions)
        {
            if (stoppingToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                // A scope per region: each migration gets its own DbContext, so a
                // failed region cannot leave tracked state that confuses the
                // next one.
                using var scope = scopes.CreateScope();

                var migration = scope.ServiceProvider.GetRequiredService<MigrateCatalogUseCase>();
                var summary = await migration.RunAsync(region, stoppingToken);

                logger.LogInformation(
                    "Snapshot migration for {Region} finished with {Status}.",
                    region,
                    summary?.Status.ToString() ?? "unknown");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                // Region and outcome only; the snapshot stays where it is.
                logger.LogWarning(
                    exception,
                    "Snapshot migration for {Region} failed; the stored snapshot is untouched.",
                    region);
            }
        }
    }
}

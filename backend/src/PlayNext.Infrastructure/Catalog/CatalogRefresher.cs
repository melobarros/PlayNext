using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// Runs a region's retrieval in the background, one at a time (research D10).
///
/// A singleton, and it has to be: the thing it guards — "is a batch already
/// running for this region?" — is a property of the process, not of a request.
/// A scoped refresher would give every visitor their own idea of whether a
/// batch was under way, which is exactly the stampede the guard exists to
/// prevent.
///
/// It resolves <see cref="CatalogUseCases"/> from a scope it creates itself,
/// rather than taking one as a dependency. Three things fall out of that, and
/// all three are why it is built this way:
/// <list type="bullet">
///   <item>No captive dependency. A singleton holding a scoped use case would
///   pin the first request's <c>DbContext</c> forever.</item>
///   <item>No construction cycle. The use case depends on this port, so this
///   cannot depend on the use case — but it can resolve one later, inside the
///   task, by which time the container is fully built.</item>
///   <item>A fresh scope per batch, so the batch gets its own <c>DbContext</c>
///   and its own <c>HttpClient</c> and disposes both when it ends.</item>
/// </list>
/// </summary>
public sealed class CatalogRefresher : ICatalogRefresher
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _regions = new(StringComparer.Ordinal);
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<CatalogRefresher> _logger;

    public CatalogRefresher(IServiceScopeFactory scopes, ILogger<CatalogRefresher> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    /// <inheritdoc />
    public bool TryStart(string region)
    {
        // One gate per region, created on first use. Non-blocking: a caller
        // that finds the gate held is not waiting for the batch, it is being
        // told the batch is already someone else's to run.
        var gate = _regions.GetOrAdd(region, _ => new SemaphoreSlim(1, 1));

        if (!gate.Wait(0))
        {
            return false;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopes.CreateScope();

                var useCases = scope.ServiceProvider.GetRequiredService<CatalogUseCases>();

                // No request's cancellation token reaches here: this work
                // outlives the request that asked for it. A visitor who gives
                // up on a cold catalog must not cancel the retrieval that
                // would have filled it for everyone else.
                await useCases.RefreshAsync(region, CancellationToken.None);

                _logger.LogInformation("Catalog retrieved for {Region}.", region);
            }
            catch (Exception exception)
            {
                // Region and outcome only. A catalog payload is bulk third-party
                // data and the provider's response may echo the credential back
                // — neither belongs in a log record (constitution, security
                // standard).
                _logger.LogWarning(
                    exception,
                    "Catalog retrieval for {Region} failed; the previous snapshot is untouched.",
                    region);
            }
            finally
            {
                gate.Release();
            }
        });

        return true;
    }

    /// <inheritdoc />
    public bool IsRunning(string region) =>
        _regions.TryGetValue(region, out var gate) && gate.CurrentCount == 0;
}

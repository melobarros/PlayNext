using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The run record's storage (data-model §8, contracts/catalog-refresh.md).
///
/// The row is the operator's account of what happened, not the catalog: it holds
/// counts and sanitized failure lines, never a title, a payload, or a header
/// (FR-018). The two JSON columns are that shape written down — the status
/// endpoint returns exactly what is stored.
/// </summary>
public sealed class CatalogRefreshRunStore(AppDbContext db) : ICatalogRefreshRunStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    /// <inheritdoc />
    public async Task<Guid> StartAsync(
        string region,
        CatalogRunKind kind,
        CatalogRunMode? mode,
        DateTimeOffset startedAt,
        CancellationToken cancellationToken)
    {
        var run = new CatalogRefreshRun
        {
            Id = Guid.NewGuid(),
            Kind = kind == CatalogRunKind.Migration ? "Migration" : "Refresh",
            Mode = mode?.ToString(),
            Region = region,
            Status = CatalogRunStatuses.Running,
            StartedAt = startedAt,
            CountsJson = "{}",
            FailuresJson = "{}",
        };

        db.CatalogRefreshRuns.Add(run);
        await db.SaveChangesAsync(cancellationToken);

        return run.Id;
    }

    /// <inheritdoc />
    public async Task CompleteAsync(
        Guid runId,
        CatalogRunOutcome outcome,
        DateTimeOffset completedAt,
        CancellationToken cancellationToken)
    {
        var run = await db.CatalogRefreshRuns
            .FirstOrDefaultAsync(row => row.Id == runId, cancellationToken);

        if (run is null)
        {
            // The run row is gone (a cleanup or a deletion between start and
            // finish). The catalog work has already happened; there is nothing
            // useful to do about a missing account of it.
            return;
        }

        run.Status = StatusName(outcome.Status);
        run.CompletedAt = completedAt;
        run.VersionId = outcome.VersionId;
        run.CountsJson = JsonSerializer.Serialize(outcome.Counts, Json);
        run.FailuresJson = JsonSerializer.Serialize(outcome.Failures, Json);
        run.Error = outcome.Error;

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<CatalogRunSummary?> LatestAsync(string region, CancellationToken cancellationToken)
    {
        var run = await db.CatalogRefreshRuns
            .AsNoTracking()
            .Where(row => row.Region == region)
            .OrderByDescending(row => row.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (run is null)
        {
            return null;
        }

        var kind = Enum.TryParse<CatalogRunKind>(run.Kind, ignoreCase: true, out var parsedKind)
            ? parsedKind
            : CatalogRunKind.Refresh;

        CatalogRunMode? mode = run.Mode is not null
            && Enum.TryParse<CatalogRunMode>(run.Mode, ignoreCase: true, out var parsedMode)
                ? parsedMode
                : null;

        var status = run.Status switch
        {
            CatalogRunStatuses.Succeeded => CatalogRunStatus.Succeeded,
            CatalogRunStatuses.PartiallyFailed => CatalogRunStatus.PartiallyFailed,
            CatalogRunStatuses.Failed => CatalogRunStatus.Failed,
            CatalogRunStatuses.Abandoned => CatalogRunStatus.Abandoned,
            _ => CatalogRunStatus.Running,
        };

        return new CatalogRunSummary(
            run.Region,
            kind,
            mode,
            status,
            run.StartedAt,
            run.CompletedAt,
            run.VersionId,
            ParseCounts(run.CountsJson),
            ParseFailures(run.FailuresJson));
    }

    /// <inheritdoc />
    public async Task<int> AbandonStaleAsync(DateTimeOffset cutoff, CancellationToken cancellationToken)
    {
        return await db.CatalogRefreshRuns
            .Where(run => run.Status == CatalogRunStatuses.Running && run.StartedAt < cutoff)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(run => run.Status, CatalogRunStatuses.Abandoned)
                    .SetProperty(run => run.CompletedAt, cutoff),
                cancellationToken);
    }

    private static string StatusName(CatalogRunStatus status) => status switch
    {
        CatalogRunStatus.Succeeded => CatalogRunStatuses.Succeeded,
        CatalogRunStatus.PartiallyFailed => CatalogRunStatuses.PartiallyFailed,
        CatalogRunStatus.Failed => CatalogRunStatuses.Failed,
        CatalogRunStatus.Abandoned => CatalogRunStatuses.Abandoned,
        _ => CatalogRunStatuses.Running,
    };

    /// <summary>
    /// The stored counts, or <c>null</c> when the column cannot be read.
    /// Unreadable operational data is reported as absent rather than turning the
    /// status endpoint into a 500 — the endpoint exists to say what happened, and
    /// "unknown" is an answer.
    /// </summary>
    private static IReadOnlyDictionary<string, CatalogRunCounts>? ParseCounts(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, CatalogRunCounts>>(json, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IReadOnlyDictionary<string, string>? ParseFailures(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

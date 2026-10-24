using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The retention deletion (T056, FR-018).
///
/// **Batched, and bounded by rows rather than by time.** A single statement over
/// every expired event would hold locks on a growing share of the table and, on
/// a large enough backlog, exceed the command timeout and roll back everything —
/// leaving a purge that never completes. Five thousand at a time commits as it
/// goes, so the pass always makes progress and a crash leaves a smaller backlog
/// rather than the same one.
///
/// **Actions are not deleted explicitly.** The foreign key cascades, so the
/// purge has one rule to get right instead of two that could disagree. What that
/// costs is that an action cannot outlive its impression — which is exactly the
/// product's rule, since an action answers a displayed card.
///
/// No transaction spans the batches: each is atomic on its own, and a partial
/// purge is not a broken state — the next pass starts from the oldest row again.
/// </summary>
public sealed class RecommendationRetentionStore(AppDbContext db) : IRecommendationRetentionStore
{
    /// <summary>Rows per statement. Large enough to be quick, small enough to be safe.</summary>
    public const int BatchSize = 5_000;

    /// <inheritdoc />
    public async Task<int> PurgeAsync(DateTimeOffset cutoff, CancellationToken cancellationToken)
    {
        var deleted = 0;

        while (true)
        {
            // The ids are read first rather than deleting straight from the
            // predicate: a delete that way would lock every matching row in one
            // statement, which is the thing batching exists to avoid.
            var ids = await db.RecommendationImpressions
                .Where(row => row.ReceivedAt < cutoff)
                .OrderBy(row => row.ReceivedAt)
                .ThenBy(row => row.Id)
                .Select(row => row.Id)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            if (ids.Count == 0) return deleted;

            deleted += await db.RecommendationImpressions
                .Where(row => ids.Contains(row.Id))
                .ExecuteDeleteAsync(cancellationToken);

            // `ExecuteDeleteAsync` bypasses the tracker, so there is nothing to
            // clear; but a second pass over the same ids must not happen, which
            // the next query guarantees by looking again.
            if (ids.Count < BatchSize) return deleted;
        }
    }
}

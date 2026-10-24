using Microsoft.EntityFrameworkCore;
using Npgsql;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.Validation;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// Writes one flush in one transaction (T026).
///
/// The whole batch commits or none of it does. A flush that stored half its
/// impressions and then failed would leave the client retrying a batch whose
/// first half is already there — which the unique index would survive, but with
/// an outcome that reports more duplicates than happened — and, worse, an
/// action could be stored against an impression that had not committed yet.
///
/// **Idempotency is the database's, not this class's.** A client retries a
/// flush whenever it does not see the 202, so the same <c>clientEventId</c>
/// arrives more than once by design. Checking before insert makes the common
/// retry cheap; the unique index is what makes it *correct* when two retries
/// overlap. That overlap is the one thing this code cannot see, so a unique
/// violation retries the batch once — on the second pass both attempts can see
/// what the first stored.
///
/// **Linking is server-side.** The client names an impression by its own
/// <c>clientEventId</c>; the row it lands on may have been stored by an earlier
/// request. An action whose impression is in neither the batch nor the table is
/// counted as unlinked rather than invented a parent.
/// </summary>
public sealed class RecommendationEventStore(AppDbContext db) : IRecommendationEventStore
{
    public async Task<RecommendationEventOutcome> RecordAsync(
        RecommendationEventBatch batch,
        Guid? userId,
        DateTimeOffset receivedAt,
        CancellationToken cancellationToken)
    {
        var impressions = batch.Impressions ?? [];
        var actions = batch.Actions ?? [];

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await RecordOnceAsync(impressions, actions, userId, receivedAt, cancellationToken);
            }
            catch (DbUpdateException exception)
                when (attempt == 0 && IsUniqueViolation(exception))
            {
                // Two overlapping retries of the same flush found the same row
                // missing and raced to insert it; this one lost. The transaction
                // has rolled back, so forget the entities it was going to add
                // and run the batch again — the winner's rows are visible now,
                // and the second pass counts them as duplicates.
                db.ChangeTracker.Clear();
            }
        }
    }

    private async Task<RecommendationEventOutcome> RecordOnceAsync(
        IReadOnlyList<RecommendationImpressionInput> impressions,
        IReadOnlyList<RecommendationActionInput> actions,
        Guid? userId,
        DateTimeOffset receivedAt,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var duplicates = 0;

        var impressionIds = impressions.Select(row => row.ClientEventId).Distinct().ToList();

        var storedImpressions = await db.RecommendationImpressions
            .Where(row => impressionIds.Contains(row.ClientEventId))
            .Select(row => row.ClientEventId)
            .ToListAsync(cancellationToken);

        var knownImpressions = storedImpressions.ToHashSet();

        var newImpressions = new List<RecommendationImpression>(impressions.Count);

        foreach (var input in impressions)
        {
            // Add returns false for a second occurrence too, though the
            // validator has already refused a batch that repeats an id.
            if (!knownImpressions.Add(input.ClientEventId))
            {
                duplicates++;
                continue;
            }

            newImpressions.Add(ToRow(input, userId, receivedAt));
        }

        db.RecommendationImpressions.AddRange(newImpressions);
        await db.SaveChangesAsync(cancellationToken);

        var actionIds = actions.Select(row => row.ClientEventId).Distinct().ToList();

        var storedActions = await db.RecommendationActions
            .Where(row => actionIds.Contains(row.ClientEventId))
            .Select(row => row.ClientEventId)
            .ToListAsync(cancellationToken);

        var knownActions = storedActions.ToHashSet();

        // Resolved *after* the impressions commit inside this transaction, so a
        // target from this same batch is found by the same query as one from an
        // earlier flush. One lookup serves both cases.
        var targetIds = actions.Select(row => row.ImpressionClientEventId).Distinct().ToList();

        var targets = await db.RecommendationImpressions
            .Where(row => targetIds.Contains(row.ClientEventId))
            .Select(row => new { row.ClientEventId, row.Id })
            .ToDictionaryAsync(row => row.ClientEventId, row => row.Id, cancellationToken);

        var unlinked = 0;
        var newActions = new List<RecommendationAction>(actions.Count);

        foreach (var input in actions)
        {
            if (!knownActions.Add(input.ClientEventId))
            {
                duplicates++;
                continue;
            }

            if (!targets.TryGetValue(input.ImpressionClientEventId, out var impressionId))
            {
                unlinked++;
                continue;
            }

            newActions.Add(new RecommendationAction
            {
                ClientEventId = input.ClientEventId,
                ImpressionId = impressionId,
                Kind = input.Kind!,
                DwellMs = input.DwellMs,
                OccurredAt = ParseOrThrow(input.OccurredAt, nameof(input.OccurredAt)),
                ReceivedAt = receivedAt,
            });
        }

        db.RecommendationActions.AddRange(newActions);
        await db.SaveChangesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return new RecommendationEventOutcome(
            newImpressions.Count,
            newActions.Count,
            duplicates,
            unlinked);
    }

    private static RecommendationImpression ToRow(
        RecommendationImpressionInput input,
        Guid? userId,
        DateTimeOffset receivedAt)
    {
        // Every value below was validated before this class ran; `!` and the
        // parse helper document that, rather than re-deciding it here where a
        // second rule could drift from the first.
        return new RecommendationImpression
        {
            ClientEventId = input.ClientEventId,
            SessionId = input.SessionId!,
            UserId = userId,
            TitleId = input.TitleId!,
            Surface = input.Surface!,
            Position = input.Position,
            EngineVersion = input.EngineVersion!,
            CatalogVersion = ParseOrThrow(input.CatalogVersion, nameof(input.CatalogVersion)),
            FilterHash = input.FilterHash!,
            Score = input.Score,
            ReasonCode = input.ReasonCode!,
            ShownAt = ParseOrThrow(input.ShownAt, nameof(input.ShownAt)),
            ReceivedAt = receivedAt,
        };
    }

    private static DateTimeOffset ParseOrThrow(string? value, string field)
    {
        // The validator accepted this batch, and its rule is the one shared
        // below — so a failure here is a programming error, not a client one,
        // and must not be reported as a bad request.
        return RecommendationEventValidator.TryParseTimestamp(value, out var parsed)
            ? parsed
            : throw new InvalidOperationException(
                $"The batch reached the store unvalidated: {field} is not a timestamp.");
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}

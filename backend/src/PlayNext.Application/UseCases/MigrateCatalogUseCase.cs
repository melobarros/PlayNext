using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Application.UseCases;

/// <summary>
/// Turns the existing JSON snapshot into a normalized version, verbatim
/// (research D6, data-model "Migration mapping").
///
/// The migration is the parity proof: ids are not renumbered, array order is
/// preserved, and every field the snapshot carries lands in its column
/// unchanged. What the snapshot cannot supply — popularity, general-pool
/// positions beyond the array index, and monetization — takes a documented
/// neutral value rather than a guess.
///
/// It is idempotent and resumable: the same snapshot timestamp upserts the same
/// building version, a newer snapshot discards the stale build, and an already
/// promoted timestamp is skipped.
/// </summary>
public sealed class MigrateCatalogUseCase(
    ICatalogSnapshotStore snapshots,
    ICatalogVersionStore versions,
    ICatalogRefreshRunStore runs,
    TimeProvider time)
{
    private static readonly IReadOnlyDictionary<string, CatalogServiceRow> KnownServices = BuildKnownServices();

    /// <summary>
    /// The counts map's key for a migration. Refresh counts are per slice; a
    /// migration has one outcome per region, so its counts sit under one name of
    /// their own rather than pretending to be a slice.
    /// </summary>
    private const string MigrationCountsKey = "migration";

    /// <summary>
    /// Attempts one migration for a region and records the outcome. Returns the
    /// stored run, or <c>null</c> when even the run row could not be written.
    /// </summary>
    public async Task<CatalogRunSummary?> RunAsync(string region, CancellationToken cancellationToken)
    {
        var startedAt = time.GetUtcNow();
        var runId = await runs.StartAsync(
            region, CatalogRunKind.Migration, mode: null, startedAt, cancellationToken);

        Guid? buildingVersionId = null;

        try
        {
            var snapshot = await snapshots.LoadAsync(region, cancellationToken);

            if (snapshot is null)
            {
                await FailAsync(runId, "no readable snapshot is within the retention limit", cancellationToken);
                return await runs.LatestAsync(region, cancellationToken);
            }

            var active = await versions.FindActiveAsync(region, cancellationToken);

            if (active is not null && active.FetchedAt == snapshot.FetchedAt)
            {
                await CompleteAsync(
                    runId,
                    CatalogRunStatus.Succeeded,
                    active.Id,
                    Counts(snapshot, skipped: snapshot.Titles.Count),
                    error: null,
                    cancellationToken);

                return await runs.LatestAsync(region, cancellationToken);
            }

            var start = await versions.BeginBuildAsync(
                region, snapshot.FetchedAt, CatalogVersionSource.Migration, cancellationToken);

            buildingVersionId = start.VersionId;

            if (start.AlreadyPromoted || start.Outdated)
            {
                buildingVersionId = null;

                await CompleteAsync(
                    runId,
                    CatalogRunStatus.Succeeded,
                    start.VersionId,
                    Counts(snapshot, skipped: snapshot.Titles.Count),
                    error: null,
                    cancellationToken);

                return await runs.LatestAsync(region, cancellationToken);
            }

            var build = Compose(snapshot);

            await versions.WriteAsync(start.VersionId, build, cancellationToken);
            await versions.PromoteAsync(start.VersionId, rollbackSnapshot: null, time.GetUtcNow(), cancellationToken);
            buildingVersionId = null;

            await CompleteAsync(
                runId,
                CatalogRunStatus.Succeeded,
                start.VersionId,
                Counts(snapshot, skipped: 0),
                error: null,
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            if (buildingVersionId is { } versionId)
            {
                await versions.DeleteAsync(versionId, CancellationToken.None);
            }

            await FailAsync(runId, exception.Message, CancellationToken.None);
        }

        return await runs.LatestAsync(region, cancellationToken);
    }

    /// <summary>
    /// The snapshot as rows, in the snapshot's own array order.
    /// </summary>
    private static CatalogBuild Compose(CatalogSnapshot snapshot)
    {
        var services = new Dictionary<string, CatalogServiceRow>(StringComparer.Ordinal);
        var rows = new List<CatalogTitleRow>(snapshot.Titles.Count);

        for (var index = 0; index < snapshot.Titles.Count; index++)
        {
            var title = snapshot.Titles[index];
            var availability = new List<CatalogAvailabilityRow>(title.Availability.Count);

            for (var position = 0; position < title.Availability.Count; position++)
            {
                var entry = title.Availability[position];
                var service = ServiceFor(entry.ProviderId);

                services.TryAdd(service.Id, service);

                // The snapshot never stored monetization, and inventing one
                // would claim a fact the source does not have.
                availability.Add(new CatalogAvailabilityRow(
                    service.Id,
                    Monetization: "unknown",
                    entry.DeepLinkUrl,
                    position,
                    snapshot.FetchedAt));
            }

            rows.Add(new CatalogTitleRow(
                title.Id,
                title.Title,
                title.ReleaseYear,
                title.MediaType,
                title.Genres,
                title.Synopsis,
                title.Rating,
                title.VoteCount,
                title.RuntimeMinutes,
                title.TrailerUrl,
                title.PosterUrl,
                Popularity: 0,
                InGeneralPool: true,
                PoolPosition: index,
                snapshot.FetchedAt,
                availability));
        }

        return new CatalogBuild(snapshot.Region, snapshot.FetchedAt, services.Values.ToList(), rows);
    }

    private static CatalogServiceRow ServiceFor(string providerId) =>
        KnownServices.TryGetValue(providerId, out var known)
            ? known
            : new CatalogServiceRow(
                providerId,
                DisplayName: providerId,
                SearchTemplate: null,
                IsQuizService: false,
                Position: CatalogVocabulary.Providers.Count);

    private static IReadOnlyDictionary<string, CatalogServiceRow> BuildKnownServices()
    {
        var services = new Dictionary<string, CatalogServiceRow>(StringComparer.Ordinal);

        for (var index = 0; index < CatalogVocabulary.Providers.Count; index++)
        {
            var provider = CatalogVocabulary.Providers[index];

            services.TryAdd(provider.ProviderId, new CatalogServiceRow(
                provider.ProviderId,
                provider.DisplayName,
                provider.SearchTemplate,
                IsQuizService: provider.VocabId is not null,
                Position: index));
        }

        return services;
    }

    private static IReadOnlyDictionary<string, CatalogRunCounts> Counts(
        CatalogSnapshot snapshot,
        int skipped)
    {
        var availabilityEntries = snapshot.Titles.Sum(title => title.Availability.Count);
        var genres = snapshot.Titles.SelectMany(title => title.Genres).Distinct(StringComparer.Ordinal).Count();

        return new Dictionary<string, CatalogRunCounts>(StringComparer.Ordinal)
        {
            [MigrationCountsKey] = new CatalogRunCounts(
                Discovered: snapshot.Titles.Count,
                Fresh: snapshot.Titles.Count,
                Carried: 0,
                Skipped: skipped,
                Enriched: 0,
                AvailabilityEntries: availabilityEntries,
                Genres: genres),
        };
    }

    private Task FailAsync(Guid runId, string error, CancellationToken cancellationToken) =>
        CompleteAsync(
            runId,
            CatalogRunStatus.Failed,
            versionId: null,
            counts: new Dictionary<string, CatalogRunCounts>(),
            error,
            cancellationToken);

    private Task CompleteAsync(
        Guid runId,
        CatalogRunStatus status,
        Guid? versionId,
        IReadOnlyDictionary<string, CatalogRunCounts> counts,
        string? error,
        CancellationToken cancellationToken) =>
        runs.CompleteAsync(
            runId,
            new CatalogRunOutcome(
                status,
                versionId,
                counts,
                new Dictionary<string, string>(StringComparer.Ordinal),
                error),
            time.GetUtcNow(),
            cancellationToken);
}

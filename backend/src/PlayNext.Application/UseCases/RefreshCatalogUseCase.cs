using System.Collections.Concurrent;
using System.Runtime.ExceptionServices;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Application.UseCases;

/// <summary>The refresh's timing and composition budget, as values.</summary>
public sealed record CatalogRefreshPolicy(
    CatalogSlicePlanOptions SlicePlan,
    TimeSpan Timeout,
    TimeSpan BuildingMaxAge,
    TimeSpan SupersededMaxAge,
    int Concurrency);

/// <summary>
/// Plans, discovers, enriches, composes, and promotes a normalized catalog
/// version (research D1, D2, D4; FR-011..FR-014).
///
/// The composition rule that makes the version always complete: <b>fresh data
/// wins per title and per (service, region) availability key; a failed slice
/// carries its last-known-good rows.</b> A first refresh with any failure
/// promotes nothing, because there is nothing to carry and a partial first
/// version would be worse than none.
/// </summary>
public sealed class RefreshCatalogUseCase(
    ICatalogProvider provider,
    ICatalogVersionStore versions,
    ICatalogRefreshRunStore runs,
    ICatalogRetentionStore retention,
    ICatalogPoolCache cache,
    ICatalogRefreshLog log,
    TimeProvider time,
    CatalogRefreshPolicy policy)
{
    /// <summary>
    /// Runs one refresh and records the outcome. Returns the stored run, or
    /// <c>null</c> when even the run row could not be written.
    /// </summary>
    public async Task<CatalogRunSummary?> RunAsync(
        string region,
        CatalogRunMode mode,
        CancellationToken cancellationToken)
    {
        var startedAt = time.GetUtcNow();
        var runId = await runs.StartAsync(region, CatalogRunKind.Refresh, mode, startedAt, cancellationToken);

        Guid? buildingVersionId = null;

        using var budget = new CancellationTokenSource(policy.Timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, budget.Token);

        try
        {
            // Lifecycle cleanup first (T056): an abandoned building version
            // from a dead process must not block this one, and a running row
            // whose owner is gone is not a refresh in progress.
            await versions.CleanupAsync(
                startedAt, policy.BuildingMaxAge, policy.SupersededMaxAge, linked.Token);
            await runs.AbandonStaleAsync(startedAt - policy.Timeout, linked.Token);

            var active = await versions.FindActiveAsync(region, linked.Token);
            var start = await versions.BeginBuildAsync(region, startedAt, CatalogVersionSource.Refresh, linked.Token);

            buildingVersionId = start.VersionId;

            if (start.Outdated || start.AlreadyPromoted)
            {
                buildingVersionId = null;

                await CompleteAsync(
                    runId,
                    CatalogRunStatus.Succeeded,
                    start.VersionId,
                    new Dictionary<string, CatalogRunCounts>(),
                    new Dictionary<string, string>(StringComparer.Ordinal),
                    error: null,
                    linked.Token);

                return await runs.LatestAsync(region, cancellationToken);
            }

            var plan = CatalogSlicePlan.Build(policy.SlicePlan);
            var enriched = new ConcurrentDictionary<string, CatalogTitleObservation>(StringComparer.Ordinal);
            var fresh = new List<SliceOutcome>(plan.Count);
            var failures = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var slice in plan)
            {
                var sliceStarted = time.GetUtcNow();

                try
                {
                    var outcome = await ExecuteSliceAsync(region, slice, enriched, linked.Token);
                    fresh.Add(outcome);

                    log.SliceCompleted(
                        region,
                        slice.Name,
                        "fresh",
                        outcome.Discovered,
                        outcome.Observations.Count,
                        0,
                        outcome.Enriched,
                        time.GetUtcNow() - sliceStarted);
                }
                catch (HttpRequestException exception)
                    when (exception.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    // A 429 that survived the retry budget aborts the run whole:
                    // pushing on would turn a rate limit into a block (research
                    // D16). No version is promoted.
                    throw new CatalogRateLimitedException();
                }
                catch (OperationCanceledException) when (budget.IsCancellationRequested)
                {
                    throw new CatalogRefreshTimeoutException();
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    failures[slice.Name] = active is null
                        ? $"{Describe(exception)}; no previous version to carry"
                        : $"{Describe(exception)}; last-known-good carried";

                    log.SliceCompleted(
                        region,
                        slice.Name,
                        "failed",
                        0,
                        0,
                        0,
                        0,
                        time.GetUtcNow() - sliceStarted);
                }
            }

            if (failures.Count > 0 && active is null)
            {
                await versions.DeleteAsync(start.VersionId, CancellationToken.None);
                buildingVersionId = null;

                await CompleteAsync(
                    runId,
                    CatalogRunStatus.Failed,
                    versionId: null,
                    new Dictionary<string, CatalogRunCounts>(),
                    failures,
                    error: "the first refresh has failed slices and nothing to carry",
                    CancellationToken.None);

                return await runs.LatestAsync(region, cancellationToken);
            }

            var previousRows = active is null
                ? []
                : await versions.LoadRowsAsync(active.Id, linked.Token);

            var fetchedAt = time.GetUtcNow();
            var composition = Compose(region, fetchedAt, plan, fresh, failures.Keys, previousRows);
            var rollbackSnapshot = ComposeRollbackSnapshot(region, fetchedAt, composition.Build);

            await versions.WriteAsync(start.VersionId, composition.Build, linked.Token);
            await versions.PromoteAsync(start.VersionId, rollbackSnapshot, fetchedAt, linked.Token);
            buildingVersionId = null;

            // A new version's entries share nothing with the old one, so the
            // eviction is correctness, not housekeeping (research D8).
            cache.Evict(start.VersionId);

            await retention.PurgeAsync(region, fetchedAt, linked.Token);

            var status = failures.Count == 0
                ? CatalogRunStatus.Succeeded
                : CatalogRunStatus.PartiallyFailed;

            await CompleteAsync(
                runId,
                status,
                start.VersionId,
                Counts(fresh, composition),
                failures,
                error: null,
                linked.Token);

            return await runs.LatestAsync(region, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || budget.IsCancellationRequested)
        {
            if (buildingVersionId is { } versionId)
            {
                await versions.DeleteAsync(versionId, CancellationToken.None);
            }

            await CompleteAsync(
                runId,
                CatalogRunStatus.Failed,
                versionId: null,
                new Dictionary<string, CatalogRunCounts>(),
                new Dictionary<string, string>(StringComparer.Ordinal),
                Describe(exception),
                CancellationToken.None);

            return await runs.LatestAsync(region, cancellationToken);
        }
    }

    /// <summary>
    /// One slice: all of its discovery queries, then one enrichment per title
    /// not already enriched by an earlier slice.
    ///
    /// Calls overlap up to <see cref="CatalogRefreshPolicy.Concurrency"/>, but
    /// the <i>results</i> do not: each query writes its own slot and each title
    /// its own, and both are read back in plan order. A batch that completed in
    /// a different order therefore composes the same version, which is what
    /// keeps pool positions and the general pool's discovery order stable.
    ///
    /// The rate limiter in the provider still spaces call starts, so the number
    /// in flight cannot raise the request rate above <c>Tmdb:RequestsPerSecond</c>.
    /// </summary>
    private async Task<SliceOutcome> ExecuteSliceAsync(
        string region,
        CatalogSlice slice,
        ConcurrentDictionary<string, CatalogTitleObservation> enriched,
        CancellationToken cancellationToken)
    {
        var discovered = new IReadOnlyList<CatalogCandidate>[slice.Queries.Count];

        await RunBoundedAsync(
            slice.Queries.Count,
            async (index, token) =>
            {
                discovered[index] = await provider.DiscoverAsync(
                    region,
                    slice,
                    slice.Queries[index],
                    token);
            },
            cancellationToken);

        var candidates = new List<CatalogCandidate>();

        foreach (var page in discovered)
        {
            candidates.AddRange(page);
        }

        var distinct = CatalogDiscoveryOrder.Distinct(candidates);
        var observations = new CatalogTitleObservation[distinct.Count];
        var pending = new List<int>(distinct.Count);

        // Titles an earlier slice already enriched cost nothing here (FR-012);
        // only the rest go to the provider. Since `distinct` holds each id once,
        // the concurrent writes below touch different keys.
        for (var index = 0; index < distinct.Count; index++)
        {
            if (enriched.TryGetValue(distinct[index].TitleId, out var known))
            {
                observations[index] = known;
            }
            else
            {
                pending.Add(index);
            }
        }

        await RunBoundedAsync(
            pending.Count,
            async (position, token) =>
            {
                var index = pending[position];
                var candidate = distinct[index];
                var observation = await provider.EnrichAsync(region, candidate, token);

                enriched[candidate.TitleId] = observation;
                observations[index] = observation;
            },
            cancellationToken);

        return new SliceOutcome(slice, candidates.Count, observations, pending.Count);
    }

    /// <summary>
    /// Runs one indexed body over <paramref name="count"/> items with at most
    /// <see cref="CatalogRefreshPolicy.Concurrency"/> calls in flight.
    ///
    /// <see cref="Parallel.ForEachAsync{TSource}(IEnumerable{TSource}, ParallelOptions, Func{TSource, CancellationToken, ValueTask})"/>
    /// cancels its own loop on the first failing body, so a slice stops paying
    /// for the rest of a batch it already knows failed. It may report one
    /// failure beside the cancellations it caused, or several failures at once;
    /// the caller's handlers distinguish a 429 from an outage from the run's own
    /// timeout, so the aggregate is unwrapped here rather than hidden behind an
    /// <see cref="AggregateException"/> none of those clauses would match.
    /// </summary>
    private async Task RunBoundedAsync(
        int count,
        Func<int, CancellationToken, ValueTask> body,
        CancellationToken cancellationToken)
    {
        try
        {
            await Parallel.ForEachAsync(
                Enumerable.Range(0, count),
                new ParallelOptions
                {
                    MaxDegreeOfParallelism = Math.Max(1, policy.Concurrency),
                    CancellationToken = cancellationToken,
                },
                body);
        }
        catch (AggregateException aggregate)
        {
            var failures = aggregate.Flatten().InnerExceptions;

            var failure = failures.FirstOrDefault(inner => inner is not OperationCanceledException)
                ?? failures[0];

            ExceptionDispatchInfo.Capture(failure).Throw();
        }
    }

    /// <summary>
    /// Merges fresh and carried slices into one complete version: one row per
    /// title, fresh wins, carried rows keep their original observation time.
    /// </summary>
    private static Composition Compose(
        string region,
        DateTimeOffset fetchedAt,
        IReadOnlyList<CatalogSlice> plan,
        IReadOnlyList<SliceOutcome> fresh,
        IEnumerable<string> failedSliceNames,
        IReadOnlyList<CatalogTitleRow> previousRows)
    {
        var drafts = new List<TitleDraft>();
        var byTitle = new Dictionary<string, TitleDraft>(StringComparer.Ordinal);
        var services = new Dictionary<string, CatalogServiceRow>(StringComparer.Ordinal);
        var nextServicePosition = 0;
        var generalPoolSize = 0;

        // Fresh slices, in plan order. The first successful slice to see a title
        // owns its discovery position (data-model "Refresh composition invariants").
        foreach (var outcome in fresh)
        {
            foreach (var observation in outcome.Observations)
            {
                var position = outcome.Slice.IsGeneral ? generalPoolSize++ : nextServicePosition++;

                if (byTitle.TryGetValue(observation.Candidate.TitleId, out var existing))
                {
                    if (outcome.Slice.IsGeneral && !existing.InGeneralPool)
                    {
                        existing.InGeneralPool = true;
                        existing.Position = Math.Min(existing.Position, position);
                    }

                    continue;
                }

                var draft = TitleDraft.Fresh(observation, outcome.Slice.IsGeneral, position, outcome.Slice.Name);

                byTitle.Add(draft.Title.Id, draft);
                drafts.Add(draft);
            }
        }

        // Carried slices: the last-known-good contribution of each failed slice.
        var failed = failedSliceNames.ToHashSet(StringComparer.Ordinal);
        var carriedCounts = new Dictionary<string, CatalogRunCounts>(StringComparer.Ordinal);

        foreach (var slice in plan.Where(slice => failed.Contains(slice.Name)))
        {
            var carried = previousRows.Where(row => Carries(slice, row)).ToList();

            carriedCounts[slice.Name] = new CatalogRunCounts(
                Carried: carried.Count,
                AvailabilityEntries: carried.Sum(row => row.Availability.Count));

            foreach (var row in carried)
            {
                if (byTitle.ContainsKey(row.TitleId))
                {
                    continue;
                }

                var draft = TitleDraft.Carried(row, slice.Name);

                byTitle.Add(row.TitleId, draft);
                drafts.Add(draft);
            }
        }

        // Rows, with availability. A fresh title's availability comes from its
        // one enrichment; a carried row keeps the entries it was observed with.
        var rows = new List<CatalogTitleRow>(drafts.Count);
        var availabilityCounts = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var draft in drafts
                     .OrderBy(draft => draft.InGeneralPool ? 0 : 1)
                     .ThenBy(draft => draft.Position)
                     .ThenBy(draft => draft.Title.Id, StringComparer.Ordinal))
        {
            var availability = draft.IsFresh
                ? AvailabilityFor(draft.Observation!, region, fetchedAt, services)
                : CarriedAvailability(draft.CarriedRow!, services);

            availabilityCounts[draft.Title.Id] = availability.Count;

            rows.Add(new CatalogTitleRow(
                draft.Title.Id,
                draft.Title.Title,
                draft.Title.ReleaseYear,
                draft.Title.MediaType,
                draft.Title.Genres,
                draft.Title.Synopsis,
                draft.Title.Rating,
                draft.Title.VoteCount,
                draft.Title.RuntimeMinutes,
                draft.Title.TrailerUrl,
                draft.Title.PosterUrl,
                draft.Popularity,
                draft.InGeneralPool,
                draft.Position,
                draft.IsFresh ? fetchedAt : draft.LastObservedAt,
                availability));
        }

        var build = new CatalogBuild(region, fetchedAt, services.Values.ToList(), rows);

        return new Composition(build, availabilityCounts, carriedCounts);
    }

    /// <summary>
    /// The rollback document (FR-029): the general pool exactly as it was just
    /// composed — carried titles included — written in the promotion
    /// transaction rather than fetched a second time.
    /// </summary>
    private static CatalogSnapshot? ComposeRollbackSnapshot(
        string region,
        DateTimeOffset fetchedAt,
        CatalogBuild build)
    {
        var general = build.Titles
            .Where(title => title.InGeneralPool)
            .OrderBy(title => title.PoolPosition)
            .ThenBy(title => title.TitleId, StringComparer.Ordinal)
            .Select(title => title.ToCatalogTitle())
            .ToList();

        return general.Count == 0 ? null : new CatalogSnapshot(region, fetchedAt, general);
    }

    /// <summary>A failed slice's prior contribution: its availability, or general-pool membership.</summary>
    private static bool Carries(CatalogSlice slice, CatalogTitleRow row) =>
        slice.IsGeneral
            ? row.InGeneralPool
            : row.Availability.Any(entry =>
                string.Equals(entry.ServiceId, slice.ServiceId, StringComparison.Ordinal));

    /// <summary>
    /// A fresh title's availability as stored: canonical service ids, the
    /// strongest monetization per service, and a link that always goes
    /// somewhere.
    /// </summary>
    private static List<CatalogAvailabilityRow> AvailabilityFor(
        CatalogTitleObservation observation,
        string region,
        DateTimeOffset observedAt,
        Dictionary<string, CatalogServiceRow> services)
    {
        var chosen = new Dictionary<string, (string Monetization, string Link, int Rank)>(StringComparer.Ordinal);

        foreach (var offer in observation.Offers)
        {
            if (!CatalogVocabulary.IsStreamable(offer.Monetization))
            {
                continue;
            }

            var known = CatalogVocabulary.TryGetProvider(offer.TmdbProviderId, out var provider)
                ? provider
                : null;

            var serviceId = known?.ProviderId ?? $"tmdb:{offer.TmdbProviderId}";

            // The service's own search when the vocabulary can address it;
            // otherwise the provider's region watch page, which is the honest
            // destination for a service we have no template for (FR-010).
            var link = CatalogVocabulary.DeepLinkFor(offer.TmdbProviderId, observation.Title.Title, region)
                ?? observation.RegionWatchLink;

            if (string.IsNullOrWhiteSpace(link))
            {
                // No template and no watch page: there is no honest
                // destination, so there is no badge.
                continue;
            }

            var rank = Rank(offer.Monetization);

            if (!chosen.TryGetValue(serviceId, out var current) || rank < current.Rank)
            {
                chosen[serviceId] = (offer.Monetization, link, rank);
            }

            services.TryAdd(serviceId, known is null
                ? new CatalogServiceRow(
                    serviceId,
                    offer.ProviderName ?? serviceId,
                    SearchTemplate: null,
                    IsQuizService: false,
                    Position: CatalogVocabulary.Providers.Count)
                : new CatalogServiceRow(
                    known.ProviderId,
                    known.DisplayName,
                    known.SearchTemplate,
                    IsQuizService: known.VocabId is not null,
                    Position: ServicePosition(known)));
        }

        return chosen
            .Select((entry, position) => new CatalogAvailabilityRow(
                entry.Key,
                entry.Value.Monetization,
                entry.Value.Link,
                position,
                observedAt))
            .ToList();
    }

    /// <summary>A carried row's availability, exactly as it was last observed (availability is never archived).</summary>
    private static List<CatalogAvailabilityRow> CarriedAvailability(
        CatalogTitleRow row,
        Dictionary<string, CatalogServiceRow> services)
    {
        foreach (var entry in row.Availability)
        {
            if (services.ContainsKey(entry.ServiceId))
            {
                continue;
            }

            var known = CatalogVocabulary.Providers.FirstOrDefault(provider =>
                string.Equals(provider.ProviderId, entry.ServiceId, StringComparison.Ordinal));

            services[entry.ServiceId] = known is null
                ? new CatalogServiceRow(
                    entry.ServiceId,
                    entry.ServiceId,
                    SearchTemplate: null,
                    IsQuizService: false,
                    Position: CatalogVocabulary.Providers.Count)
                : new CatalogServiceRow(
                    known.ProviderId,
                    known.DisplayName,
                    known.SearchTemplate,
                    IsQuizService: known.VocabId is not null,
                    Position: ServicePosition(known));
        }

        return row.Availability.OrderBy(entry => entry.Position).ToList();
    }

    private static int ServicePosition(CatalogProvider provider)
    {
        for (var index = 0; index < CatalogVocabulary.Providers.Count; index++)
        {
            if (string.Equals(
                    CatalogVocabulary.Providers[index].ProviderId,
                    provider.ProviderId,
                    StringComparison.Ordinal))
            {
                return index;
            }
        }

        return CatalogVocabulary.Providers.Count;
    }

    /// <summary>Flatrate first, then free, then ads — how a visitor can watch tonight.</summary>
    private static int Rank(string monetization) => monetization switch
    {
        "flatrate" => 0,
        "free" => 1,
        "ads" => 2,
        _ => 3,
    };

    private static IReadOnlyDictionary<string, CatalogRunCounts> Counts(
        IReadOnlyList<SliceOutcome> fresh,
        Composition composition)
    {
        var counts = new Dictionary<string, CatalogRunCounts>(StringComparer.Ordinal);

        foreach (var outcome in fresh)
        {
            counts[outcome.Slice.Name] = new CatalogRunCounts(
                Discovered: outcome.Discovered,
                Fresh: outcome.Observations.Count,
                Carried: 0,
                Skipped: 0,
                Enriched: outcome.Enriched,
                AvailabilityEntries: outcome.Observations.Sum(observation =>
                    composition.AvailabilityCounts.GetValueOrDefault(observation.Candidate.TitleId)));
        }

        foreach (var entry in composition.CarriedCounts)
        {
            counts[entry.Key] = entry.Value;
        }

        return counts;
    }

    private static string Describe(Exception exception) => exception switch
    {
        CatalogRateLimitedException => "provider rate-limited the run after retries",
        CatalogRefreshTimeoutException => "refresh exceeded its soft timeout",
        HttpRequestException { StatusCode: { } status } => $"provider returned HTTP {(int)status}",
        HttpRequestException => "provider call failed",
        OperationCanceledException => "provider call timed out",
        _ => "provider call failed",
    };

    private async Task CompleteAsync(
        Guid runId,
        CatalogRunStatus status,
        Guid? versionId,
        IReadOnlyDictionary<string, CatalogRunCounts> counts,
        IReadOnlyDictionary<string, string> failures,
        string? error,
        CancellationToken cancellationToken) =>
        await runs.CompleteAsync(
            runId,
            new CatalogRunOutcome(status, versionId, counts, failures, error),
            time.GetUtcNow(),
            cancellationToken);

    /// <summary>One slice's discovery result, before composition.</summary>
    private sealed record SliceOutcome(
        CatalogSlice Slice,
        int Discovered,
        IReadOnlyList<CatalogTitleObservation> Observations,
        int Enriched);

    /// <summary>A complete composition, plus the per-title counts the run records.</summary>
    private sealed record Composition(
        CatalogBuild Build,
        IReadOnlyDictionary<string, int> AvailabilityCounts,
        IReadOnlyDictionary<string, CatalogRunCounts> CarriedCounts);

    /// <summary>A title being composed: fresh from this run, or carried from the previous version.</summary>
    private sealed class TitleDraft
    {
        private TitleDraft(
            CatalogTitle title,
            double popularity,
            bool inGeneralPool,
            int position,
            string owner,
            CatalogTitleObservation? observation,
            CatalogTitleRow? carriedRow,
            DateTimeOffset lastObservedAt)
        {
            Title = title;
            Popularity = popularity;
            InGeneralPool = inGeneralPool;
            Position = position;
            Owner = owner;
            Observation = observation;
            CarriedRow = carriedRow;
            LastObservedAt = lastObservedAt;
        }

        public CatalogTitle Title { get; }

        public double Popularity { get; }

        public bool InGeneralPool { get; set; }

        public int Position { get; set; }

        public string Owner { get; }

        public CatalogTitleObservation? Observation { get; }

        public CatalogTitleRow? CarriedRow { get; }

        public DateTimeOffset LastObservedAt { get; }

        public bool IsFresh => Observation is not null;

        public static TitleDraft Fresh(
            CatalogTitleObservation observation,
            bool inGeneralPool,
            int position,
            string owner) => new(
            observation.Title,
            observation.Candidate.Popularity,
            inGeneralPool,
            position,
            owner,
            observation,
            carriedRow: null,
            lastObservedAt: default);

        public static TitleDraft Carried(CatalogTitleRow row, string owner) => new(
            row.ToCatalogTitle(),
            row.Popularity,
            row.InGeneralPool,
            row.PoolPosition,
            owner,
            observation: null,
            row,
            row.LastObservedAt);
    }
}

/// <summary>The provider rate-limited the run past its retry budget.</summary>
public sealed class CatalogRateLimitedException()
    : Exception("The catalog provider rate-limited the refresh.");

/// <summary>The refresh exceeded <c>Catalog:RefreshTimeoutMinutes</c>.</summary>
public sealed class CatalogRefreshTimeoutException()
    : Exception("The catalog refresh exceeded its soft timeout.");

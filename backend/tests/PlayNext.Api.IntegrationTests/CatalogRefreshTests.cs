using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// What a full normalized refresh stores (T031, T048).
///
/// The refresh is the only operation that builds a version out of live provider
/// answers, so the questions here are about what it promises: every slice
/// reaches its configured depth, one enrichment per unique title leaves each
/// title's availability complete, and the version that is promoted holds one row
/// per title and one row per (title, service).
///
/// The expectations are derived from the stub's published rules
/// (<see cref="StubTmdbHandler.Carries"/>, <see cref="StubTmdbHandler.BandIndex"/>)
/// rather than from hard-coded id lists. A list would still pass if the version
/// held the right count in the wrong order; a derivation pins membership and
/// order to the rule the catalog claims to implement. The one fixed list is the
/// general pool's, because the stub's handcrafted titles are themselves a
/// fixture and which genre queries reach them is the thing being asserted.
///
/// The use case is driven directly, as in the rest of the normalized suites: a
/// test about what a refresh stores wants the finished run in hand, not a 202
/// plus a poll. The admin surface has its own suite (T049).
/// </summary>
[Collection("catalog")]
public sealed class Catalog_refresh(CatalogApiFactory api) : NormalizedCatalogTest(api)
{
    private const int HorrorGenreId = 27;

    /// <summary>MUBI, in the stub's quiz-service order — the service whose titles also carry an unknown provider.</summary>
    private const int MubiServiceIndex = 7;

    private static readonly int HorrorBand = StubTmdbHandler.BandIndex(HorrorGenreId);

    /// <summary>
    /// The eight handcrafted titles the general recipe discovers, in the order
    /// the general slice first sees them: the quiz's genres movie-then-tv, and
    /// the two anime streams last.
    /// </summary>
    private static readonly string[] GeneralPool =
    [
        "tmdb:movie:27205",
        "tmdb:movie:346",
        "tmdb:movie:129",
        "tmdb:movie:550",
        "tmdb:tv:1396",
        "tmdb:movie:157336",
        "tmdb:movie:862",
        "tmdb:tv:1429",
    ];

    /// <summary>One full refresh over the stub's synthetic bands, returning its succeeded run.</summary>
    private async Task<CatalogRunSummary> DeepRefreshAsync()
    {
        await _api.ResetCatalogAsync();
        UseNormalized();

        var run = await RefreshAsync();

        Assert.NotNull(run);
        Assert.Equal(CatalogRunKind.Refresh, run!.Kind);
        Assert.Equal(CatalogRunStatus.Succeeded, run.Status);
        Assert.NotNull(run.VersionId);
        Assert.NotNull(run.Failures);
        Assert.Empty(run.Failures!);

        return run;
    }

    /// <summary>A version's rows, as the composed build left them.</summary>
    private async Task<IReadOnlyList<CatalogTitleRow>> RowsAsync(Guid versionId)
    {
        using var scope = _api.Services.CreateScope();

        return await scope.ServiceProvider
            .GetRequiredService<ICatalogVersionStore>()
            .LoadRowsAsync(versionId, CancellationToken.None);
    }

    private static int ServiceIndex(string serviceId) =>
        Array.FindIndex(StubTmdbHandler.QuizServices, entry => entry.ServiceId == serviceId);

    /// <summary>A targeted pool's contract order: popularity descending, then id.</summary>
    private static string[] InPoolOrder(IEnumerable<string> ids) =>
        [.. ids.OrderByDescending(StubTmdbHandler.PopularityOf)
            .ThenBy(id => id, StringComparer.Ordinal)];

    /// <summary>The ids a service's genre queries discover for one band and media type.</summary>
    private static IEnumerable<int> DiscoveredIndices(int serviceIndex, int depth) =>
        Enumerable.Range(0, StubTmdbHandler.BandTitles)
            .Where(index => StubTmdbHandler.Carries(serviceIndex, index))
            .OrderBy(index => index)
            .Take(depth);

    [Fact]
    public async Task A_full_refresh_promotes_one_version_holding_the_general_pool_and_every_service_slice()
    {
        var run = await DeepRefreshAsync();

        // One version, promoted: the build that was written is the one readers
        // can pin, and no stale building version is left beside it.
        var active = Assert.Single(await VersionsAsync());

        Assert.Equal(run.VersionId, active.Id);
        Assert.Equal(CatalogVersionStates.Active, active.State);
        Assert.Equal(CatalogVersionSources.Refresh, active.Source);
        Assert.NotNull(active.CompletedAt);

        var rows = await RowsAsync(active.Id);
        var synthetic = rows.Where(row => !row.InGeneralPool).ToList();

        var depth = ProviderOptions.ServiceTitlesPerGenre;

        // The suite tunes the depth down to forty (CatalogApiFactory) so a full
        // refresh stays fast; the version's shape follows from that number.
        Assert.Equal(40, depth);

        // The stub carries forty-one of each band's forty-five titles, and each
        // service discovers the top forty of them — the union is 0..43, so
        // forty-four per band and media type × nine bands × two types.
        var perBandAndType = StubTmdbHandler.BandTitles - 1;

        Assert.Equal(CatalogVocabulary.GenreIds.Count * 2 * perBandAndType, synthetic.Count);
        Assert.Equal(GeneralPool.Length + synthetic.Count, rows.Count);

        // A title reached by six services is still one title.
        Assert.Equal(
            rows.Count,
            rows.Select(row => row.TitleId).Distinct(StringComparer.Ordinal).Count());

        // The general pool is the 005 sample, in its discovery order — the
        // backward-compatibility promise (FR-004) that the service slices sit
        // beside rather than replace.
        var general = rows
            .Where(row => row.InGeneralPool)
            .OrderBy(row => row.PoolPosition)
            .Select(row => row.TitleId)
            .ToArray();

        Assert.Equal(GeneralPool, general);

        // Every quiz service's slice reaches the configured depth. The count is
        // of availability rows on non-general titles, so it can only be right if
        // the service's own discover calls found that many titles *and* the
        // composition kept each one's badges.
        foreach (var service in StubTmdbHandler.QuizServices)
        {
            var observed = synthetic
                .SelectMany(row => row.Availability)
                .Count(entry => string.Equals(entry.ServiceId, service.ServiceId, StringComparison.Ordinal));

            Assert.Equal(depth * CatalogVocabulary.GenreIds.Count * 2, observed);
        }

        // The provider the vocabulary cannot name is stored as data rather than
        // dropped, one entry on every title MUBI carries (FR-010).
        var regional = synthetic
            .SelectMany(row => row.Availability)
            .Count(entry => string.Equals(
                entry.ServiceId,
                $"tmdb:{StubTmdbHandler.UnknownProviderId}",
                StringComparison.Ordinal));

        Assert.Equal(depth * CatalogVocabulary.GenreIds.Count * 2, regional);

        // The run records one line per slice, so an operator can see which
        // service was shallow without reading the tables.
        var counts = run.Counts!;

        Assert.Equal(StubTmdbHandler.QuizServices.Length + 1, counts.Count);
        Assert.Equal(GeneralPool.Length, counts[CatalogSlicePlan.GeneralSliceName].Fresh);

        // The general slice's handcrafted availability entries: two + none +
        // one + two + one + two + one + none, per GeneralPool's order.
        Assert.Equal(9, counts[CatalogSlicePlan.GeneralSliceName].AvailabilityEntries);

        foreach (var service in StubTmdbHandler.QuizServices)
        {
            Assert.Equal(depth * CatalogVocabulary.GenreIds.Count * 2, counts[service.ServiceId].Fresh);
        }

        // One enrichment per unique title across the twelve slices (FR-012).
        // The totals add up to the version's titles exactly because a title
        // discovered by a second service was not enriched a second time.
        Assert.Equal(rows.Count, counts.Values.Sum(slice => slice.Enriched));

        // The services the refresh observed are the quiz's own, marked as such;
        // the vocabulary seeder's rows are not what these assertions created.
        var quizServices = await WithDbAsync(db => db.CatalogServices
            .AsNoTracking()
            .Where(service => service.IsQuizService)
            .Select(service => service.Id)
            .ToListAsync());

        foreach (var service in StubTmdbHandler.QuizServices)
        {
            Assert.Contains(service.ServiceId, quizServices);
        }
    }

    [Fact]
    public async Task Netflix_and_max_horror_pools_reach_the_stub_s_reported_depth()
    {
        await DeepRefreshAsync();

        var depth = ProviderOptions.ServiceTitlesPerGenre;

        // The assertion is against the stub's reported depth, which is what
        // "deep rather than sampled" means at the suite's tuning. The pool cap
        // is larger than the answer, so truncation is not what shapes it.
        Assert.Equal(40, depth);
        Assert.True(2 * depth < CatalogOptions.MaxPoolTitles);

        foreach (var serviceId in new[] { "netflix", "max" })
        {
            var service = ServiceIndex(serviceId);

            Assert.True(service >= 0);

            // What the service's own discover calls returned for horror: its
            // carriers, most popular first (the stub orders a band by index),
            // cut at the quota — and each index contributes a film and a series.
            var expected = InPoolOrder(DiscoveredIndices(service, depth)
                .SelectMany(index => new[]
                {
                    StubTmdbHandler.SyntheticTitleId(isMovie: true, HorrorBand, index),
                    StubTmdbHandler.SyntheticTitleId(isMovie: false, HorrorBand, index),
                }));

            var ids = Ids(await CatalogAsync("BR", $"services={serviceId}&genres=horror"));

            Assert.Equal(expected, ids);
            Assert.Equal(2 * depth, ids.Length);
            Assert.Equal(ids.Length, ids.Distinct(StringComparer.Ordinal).Count());
        }
    }

    [Fact]
    public async Task Every_title_s_availability_is_complete_after_one_enrichment_pass()
    {
        var run = await DeepRefreshAsync();
        var rows = await RowsAsync(run.VersionId!.Value);
        var synthetic = rows.Where(row => !row.InGeneralPool).ToList();
        var byId = synthetic.ToDictionary(row => row.TitleId, StringComparer.Ordinal);

        // The stub's own rule, applied to every band title, is the expected
        // answer: a title's badges are every service that carries it — plus the
        // region-watch-page fallback MUBI's titles also carry. A title enriched
        // before its second service was known to carry it would come up short
        // here, which is the one-enrichment promise (research D4).
        var expected = new Dictionary<string, string[]>(StringComparer.Ordinal);

        foreach (var isMovie in new[] { true, false })
        {
            for (var band = 0; band < CatalogVocabulary.GenreIds.Count; band++)
            {
                for (var index = 0; index < StubTmdbHandler.BandTitles; index++)
                {
                    var id = StubTmdbHandler.SyntheticTitleId(isMovie, band, index);

                    if (!byId.ContainsKey(id))
                    {
                        continue;
                    }

                    var services = Enumerable.Range(0, StubTmdbHandler.QuizServices.Length)
                        .Where(serviceIndex => StubTmdbHandler.Carries(serviceIndex, index))
                        .Select(serviceIndex => StubTmdbHandler.QuizServices[serviceIndex].ServiceId)
                        .ToList();

                    if (StubTmdbHandler.Carries(MubiServiceIndex, index))
                    {
                        services.Add($"tmdb:{StubTmdbHandler.UnknownProviderId}");
                    }

                    expected[id] = [.. services];
                }
            }
        }

        Assert.Equal(synthetic.Count, expected.Count);

        foreach (var row in synthetic)
        {
            var wanted = expected[row.TitleId].OrderBy(id => id, StringComparer.Ordinal);

            var actual = row.Availability
                .Select(entry => entry.ServiceId)
                .OrderBy(id => id, StringComparer.Ordinal);

            Assert.Equal(wanted, actual);

            // Every badge goes somewhere: the service's template or the
            // region's watch page.
            Assert.All(row.Availability, entry =>
                Assert.StartsWith("https://", entry.DeepLinkUrl, StringComparison.Ordinal));
        }

        // No title is stored twice, and a service appears at most once on a
        // title — two provider ids for one service fold into one badge.
        Assert.Equal(
            rows.Count,
            rows.Select(row => row.TitleId).Distinct(StringComparer.Ordinal).Count());

        var pairs = rows
            .SelectMany(row => row.Availability.Select(entry => (row.TitleId, entry.ServiceId)))
            .ToList();

        Assert.Equal(pairs.Count, pairs.Distinct().Count());

        // The handcrafted titles are the region and vocabulary cases: a folded
        // alias, an unmapped provider, a rent-only title with no badge, and a
        // provider no vocabulary can name.
        var handcrafted = rows
            .Where(row => row.InGeneralPool)
            .ToDictionary(
                row => row.TitleId,
                row => row.Availability
                    .Select(entry => entry.ServiceId)
                    .OrderBy(id => id, StringComparer.Ordinal)
                    .ToArray(),
                StringComparer.Ordinal);

        Assert.Equal(new[] { "netflix", "tmdb:300" }, handcrafted["tmdb:movie:27205"]);
        Assert.Empty(handcrafted["tmdb:movie:157336"]);
        Assert.Equal(new[] { "prime-video" }, handcrafted["tmdb:tv:1396"]);
        Assert.Equal(new[] { "crunchyroll", "netflix" }, handcrafted["tmdb:tv:1429"]);
        Assert.Equal(new[] { "netflix" }, handcrafted["tmdb:movie:129"]);
        Assert.Equal(new[] { "netflix", "tmdb:192" }, handcrafted["tmdb:movie:862"]);
        Assert.Equal(new[] { "tmdb:999999" }, handcrafted["tmdb:movie:346"]);
        Assert.Empty(handcrafted["tmdb:movie:550"]);

        // The unknown provider keeps the watch page as its destination, because
        // no template exists to link to and a template-less badge would be a
        // dead end (FR-007, research D7).
        var regional = rows.Single(row => row.TitleId == "tmdb:movie:346").Availability.Single();

        Assert.Equal("https://www.themoviedb.org/movie/346/watch", regional.DeepLinkUrl);
    }

    // -----------------------------------------------------------------------
    // What a refresh that does not go perfectly still promises (T048)
    // -----------------------------------------------------------------------

    /// <summary>The error line the latest run stored, which the summary does not carry.</summary>
    private Task<string?> LatestRunErrorAsync() =>
        WithDbAsync(db => db.CatalogRefreshRuns
            .AsNoTracking()
            .OrderByDescending(run => run.StartedAt)
            .Select(run => run.Error)
            .FirstOrDefaultAsync());

    /// <summary>
    /// A build that was started and never promoted — what a process killed
    /// mid-refresh leaves behind, and the state the rerun has to replace rather
    /// than duplicate.
    /// </summary>
    private async Task<Guid> SeedInterruptedBuildAsync(DateTimeOffset startedAt)
    {
        using var scope = _api.Services.CreateScope();

        var store = scope.ServiceProvider.GetRequiredService<ICatalogVersionStore>();

        var start = await store.BeginBuildAsync(
            "BR",
            startedAt,
            CatalogVersionSource.Refresh,
            CancellationToken.None);

        await store.WriteAsync(
            start.VersionId,
            new CatalogBuild(
                "BR",
                startedAt,
                [],
                [
                    new CatalogTitleRow(
                        "tmdb:movie:599999",
                        "Half A Build",
                        2001,
                        CatalogMediaType.Movie,
                        ["horror"],
                        "A title only the interrupted build knows.",
                        5.0,
                        10,
                        100,
                        null,
                        null,
                        1.0,
                        false,
                        0,
                        startedAt,
                        []),
                ]),
            CancellationToken.None);

        return start.VersionId;
    }

    /// <summary>Each title's badges and destinations, as a comparable signature.</summary>
    private static Dictionary<string, string[]> AvailabilityByTitle(
        IReadOnlyList<CatalogTitleRow> rows) =>
        rows.ToDictionary(
            row => row.TitleId,
            row => row.Availability
                .Select(entry => $"{entry.ServiceId}|{entry.DeepLinkUrl}")
                .OrderBy(entry => entry, StringComparer.Ordinal)
                .ToArray(),
            StringComparer.Ordinal);

    [Fact]
    public async Task One_failed_slice_promotes_a_complete_version_carrying_its_last_known_good_data()
    {
        var first = await DeepRefreshAsync();

        var before = await RowsAsync(first.VersionId!.Value);
        var beforeAvailability = AvailabilityByTitle(before);

        var mubiRows = before
            .Where(row => row.Availability.Any(entry => string.Equals(
                entry.ServiceId,
                "mubi",
                StringComparison.Ordinal)))
            .ToList();

        var depth = ProviderOptions.ServiceTitlesPerGenre;

        // MUBI carries forty of each band's forty-four discovered titles, so its
        // last-known-good contribution is the whole of its slice.
        Assert.Equal(depth * CatalogVocabulary.GenreIds.Count * 2, mubiRows.Count);

        // Only MUBI's discovery calls fail: its slice is the one that has to be
        // carried, while every other slice runs against a working provider.
        _api.Tmdb.FailingProviderIds.Add(11);

        var run = await RefreshAsync();

        Assert.NotNull(run);
        Assert.Equal(CatalogRunStatus.PartiallyFailed, run!.Status);
        Assert.NotNull(run.VersionId);
        Assert.NotEqual(first.VersionId, run.VersionId);

        var failures = run.Failures!;

        Assert.Equal(new[] { "mubi" }, failures.Keys);
        Assert.Contains("last-known-good carried", failures["mubi"]);
        Assert.DoesNotContain("no previous version", failures["mubi"]);

        // Fresh everywhere else: each surviving slice reached its configured
        // depth, and the union of them still enriched every title once.
        var counts = run.Counts!;

        Assert.Equal(StubTmdbHandler.QuizServices.Length + 1, counts.Count);
        Assert.Equal(GeneralPool.Length, counts[CatalogSlicePlan.GeneralSliceName].Fresh);

        foreach (var service in StubTmdbHandler.QuizServices.Where(
                     service => service.ServiceId != "mubi"))
        {
            Assert.Equal(depth * CatalogVocabulary.GenreIds.Count * 2, counts[service.ServiceId].Fresh);
        }

        // The failed slice's line is its carried contribution, not a zero: an
        // operator reading the run sees the data the version kept for it.
        var carried = counts["mubi"];

        Assert.Equal(0, carried.Discovered);
        Assert.Equal(0, carried.Fresh);
        Assert.Equal(mubiRows.Count, carried.Carried);
        Assert.Equal(mubiRows.Sum(row => row.Availability.Count), carried.AvailabilityEntries);
        Assert.Equal(before.Count, counts.Values.Sum(slice => slice.Enriched));

        // Exactly one new version was promoted, and the old one was superseded
        // rather than left active.
        var versions = await VersionsAsync();

        Assert.Equal(2, versions.Count);
        Assert.Equal(
            CatalogVersionStates.Active,
            versions.Single(version => version.Id == run.VersionId).State);
        Assert.Equal(
            CatalogVersionStates.Superseded,
            versions.Single(version => version.Id == first.VersionId).State);

        // The promoted version is complete: every title the previous version
        // had, with the availability it had. MUBI's badges survive the failed
        // slice because a title's availability comes from its own enrichment,
        // which another slice performed — the failed slice costs freshness, not
        // data.
        var after = await RowsAsync(run.VersionId!.Value);

        Assert.Equal(before.Count, after.Count);
        Assert.Equal(
            before.Select(row => row.TitleId).OrderBy(id => id, StringComparer.Ordinal),
            after.Select(row => row.TitleId).OrderBy(id => id, StringComparer.Ordinal));

        var afterAvailability = AvailabilityByTitle(after);

        foreach (var (titleId, expected) in beforeAvailability)
        {
            Assert.True(
                afterAvailability.TryGetValue(titleId, out var actual),
                $"{titleId} was lost by the failed slice");

            Assert.Equal(expected, actual!);
        }
    }

    [Fact]
    public async Task A_first_refresh_with_a_failed_slice_promotes_nothing()
    {
        await _api.ResetCatalogAsync();
        UseNormalized();

        _api.Tmdb.FailingProviderIds.Add(11);

        var run = await RefreshAsync();

        Assert.NotNull(run);
        Assert.Equal(CatalogRunStatus.Failed, run!.Status);
        Assert.Null(run.VersionId);
        Assert.Empty(run.Counts!);

        var failures = run.Failures!;

        Assert.Equal(new[] { "mubi" }, failures.Keys);
        Assert.Contains("no previous version to carry", failures["mubi"]);

        // There was nothing to carry and a partial first version would be worse
        // than none: the build is deleted rather than promoted, and no
        // half-built version is left behind either.
        Assert.Empty(await VersionsAsync());
        Assert.Equal(0, await WithDbAsync(db => db.CatalogTitles.CountAsync()));

        var error = await LatestRunErrorAsync() ?? string.Empty;

        Assert.Contains("nothing to carry", error);
    }

    [Fact]
    public async Task A_rate_limit_beyond_the_retry_budget_aborts_the_run_and_keeps_the_previous_version()
    {
        var first = await DeepRefreshAsync();

        var titlesBefore = await TitleCountAsync(first.VersionId!.Value);

        // Longer than the client's maximum wait, so the first call abandons the
        // batch instead of retrying into the limit.
        _api.Tmdb.RefusesWith = HttpStatusCode.TooManyRequests;

        var run = await RefreshAsync();

        Assert.NotNull(run);
        Assert.Equal(CatalogRunStatus.Failed, run!.Status);
        Assert.Null(run.VersionId);
        Assert.Empty(run.Counts!);
        Assert.Empty(run.Failures!);

        // The previous version is still the only one: the aborted build was
        // deleted, not promoted, and not left in a Building state.
        var active = Assert.Single(await VersionsAsync());

        Assert.Equal(first.VersionId, active.Id);
        Assert.Equal(CatalogVersionStates.Active, active.State);
        Assert.Equal(titlesBefore, await TitleCountAsync(active.Id));

        var error = await LatestRunErrorAsync() ?? string.Empty;

        Assert.Contains("rate-limited", error);
    }

    [Fact]
    public async Task An_interrupted_build_is_replaced_by_the_rerun_without_duplicates()
    {
        var first = await DeepRefreshAsync();

        // A build from an earlier attempt that died before promotion. It is
        // older than the version the rerun will fetch, so the rerun replaces it.
        var interruptedId = await SeedInterruptedBuildAsync(DateTimeOffset.UtcNow.AddMinutes(-5));

        var run = await RefreshAsync();

        Assert.NotNull(run);
        Assert.Equal(CatalogRunStatus.Succeeded, run!.Status);
        Assert.NotNull(run.VersionId);
        Assert.Empty(run.Failures!);

        // The half-written version is gone rather than left beside the new one,
        // and its rows went with it.
        var versions = await VersionsAsync();

        Assert.DoesNotContain(versions, version => version.Id == interruptedId);
        Assert.Equal(2, versions.Count);
        Assert.Equal(
            CatalogVersionStates.Active,
            versions.Single(version => version.Id == run.VersionId).State);
        Assert.Equal(
            CatalogVersionStates.Superseded,
            versions.Single(version => version.Id == first.VersionId).State);

        var rows = await RowsAsync(run.VersionId!.Value);

        // The resumed write replaced rather than appended, so the version is one
        // row per title and none of the interrupted build's data survives.
        var expectedTitles = GeneralPool.Length
            + (StubTmdbHandler.BandTitles - 1) * CatalogVocabulary.GenreIds.Count * 2;

        Assert.Equal(expectedTitles, rows.Count);
        Assert.Equal(
            rows.Count,
            rows.Select(row => row.TitleId).Distinct(StringComparer.Ordinal).Count());
        Assert.DoesNotContain(rows, row => row.Name == "Half A Build");
        Assert.Equal(0, await TitleCountAsync(interruptedId));
    }

    [Fact]
    public async Task A_successful_general_slice_writes_the_rollback_snapshot_as_part_of_the_promotion()
    {
        await DeepRefreshAsync();

        var active = await ActiveVersionOrFailAsync();
        var payload = await _api.StoredPayloadAsync("BR");

        Assert.NotNull(payload);

        var document = JsonNode.Parse(payload!)!.AsObject();
        var storedAt = document["fetchedAt"]!.GetValue<DateTimeOffset>();

        Assert.Equal("BR", document["region"]!.GetValue<string>());

        // Written from the composition just built, inside the promotion
        // transaction — the same instant the version records (SC-014).
        Assert.True(
            (storedAt - active.FetchedAt).Duration() < TimeSpan.FromSeconds(1),
            $"snapshot {storedAt:o} does not match the version's {active.FetchedAt:o}");

        var storedIds = document["titles"]!.AsArray()
            .Select(title => title!["id"]!.GetValue<string>())
            .ToArray();

        Assert.Equal(GeneralPool, storedIds);

        // And the rollback path serves it: the general pool, in its order,
        // without the normalized tables being consulted at all.
        UseSnapshot();
        _api.ClearMemory();

        var (status, _, body) = await CatalogResponseAsync("BR");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(GeneralPool, Ids(body));
    }
}

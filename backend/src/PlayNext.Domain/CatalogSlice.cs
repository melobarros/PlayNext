namespace PlayNext.Domain;

/// <summary>
/// One title a discovery query returned, before enrichment (feature 008,
/// research D2). Identity is the catalog's own id, so a title reached through
/// two services or genres is recognisably one title.
/// </summary>
/// <param name="Popularity">The provider's popularity for the title, used to order a targeted pool.</param>
public sealed record CatalogCandidate(string TitleId, bool IsMovie, int TmdbId, double Popularity);

/// <summary>
/// One service carrying a title, with the monetization the provider reported.
/// Unlike <see cref="StreamingAvailability"/> this is not yet a badge: a service
/// the vocabulary cannot address is kept as data and stored, rather than
/// dropped (FR-010, research D7).
/// </summary>
public sealed record CatalogOffer(int TmdbProviderId, string? ProviderName, string Monetization);

/// <summary>One discover query: what to ask for, and how many titles it is worth.</summary>
/// <param name="IsMovie">Whether the underlying provider type is movie.</param>
/// <param name="GenreIds">Provider genre ids, all required (AND).</param>
/// <param name="OriginalLanguage">A provider language filter, used for anime streams.</param>
/// <param name="Target">Stop paging once this many titles are collected.</param>
public sealed record CatalogDiscoveryQuery(
    bool IsMovie,
    IReadOnlyList<int> GenreIds,
    string? OriginalLanguage,
    int Target);

/// <summary>
/// One independently-failable part of a refresh: the general pool (the rollback
/// snapshot's source) or one quiz service's catalog (research D2).
/// </summary>
/// <param name="Name">The name used in run counts and failure summaries.</param>
/// <param name="ServiceId">The quiz service's id, or <c>null</c> for the general slice.</param>
/// <param name="ProviderIds">
/// Every provider id that resolves to this service, aliases included, so
/// discovery filters for all of them at once.
/// </param>
/// <param name="IsQuizService">Whether this slice is one of the quiz's services.</param>
/// <param name="Queries">The discover queries, in a fixed order.</param>
/// <param name="MaxPages">The discovery paging cap applied to every query.</param>
public sealed record CatalogSlice(
    string Name,
    string? ServiceId,
    IReadOnlyList<int> ProviderIds,
    bool IsQuizService,
    IReadOnlyList<CatalogDiscoveryQuery> Queries,
    int MaxPages)
{
    public bool IsGeneral => ServiceId is null;
}

/// <summary>The inputs a slice plan is built from (values, not options objects, so Domain stays framework-free).</summary>
public sealed record CatalogSlicePlanOptions(
    int GeneralMoviesPerGenre,
    int GeneralTvPerGenre,
    int GeneralAnimeQuota,
    int ServiceTitlesPerGenre,
    int MaxDiscoverPages);

/// <summary>
/// The plan a normalized refresh executes (research D2).
///
/// Two kinds of slice, both built here so the order is fixed and reproducible
/// (constitution VI):
/// <list type="bullet">
///   <item><b>General</b> — the 005 recipe: nine genres × movie/TV, plus an
///   anime quota. It owns the general pool and is the rollback snapshot's
///   source.</item>
///   <item><b>Per service</b> — for each of the eleven quiz services: nine
///   genres × movie/TV, per-genre anime streams, and an any-genre anime stream.
///   Discovery is filtered by that service's provider ids and the region, which
///   is what makes a service + genre pool deep instead of a slice of the general
///   sample.</item>
/// </list>
/// </summary>
public static class CatalogSlicePlan
{
    public const string GeneralSliceName = "general";

    /// <summary>The eleven services the quiz offers, in provider-vocabulary order, with aliases folded in.</summary>
    public static IReadOnlyList<CatalogProvider> QuizServices { get; } = BuildQuizServices();

    public static IReadOnlyList<CatalogSlice> Build(CatalogSlicePlanOptions options)
    {
        var slices = new List<CatalogSlice>(QuizServices.Count + 1)
        {
            BuildGeneral(options),
        };

        foreach (var service in QuizServices)
        {
            slices.Add(BuildService(service, options));
        }

        return slices;
    }

    private static CatalogSlice BuildGeneral(CatalogSlicePlanOptions options)
    {
        var queries = new List<CatalogDiscoveryQuery>();

        foreach (var genreId in CatalogVocabulary.GenreIds)
        {
            queries.Add(new CatalogDiscoveryQuery(true, [genreId], null, options.GeneralMoviesPerGenre));
            queries.Add(new CatalogDiscoveryQuery(false, [genreId], null, options.GeneralTvPerGenre));
        }

        queries.Add(new CatalogDiscoveryQuery(
            true,
            [CatalogClassification.AnimationGenreId],
            CatalogClassification.JapaneseLanguage,
            options.GeneralAnimeQuota));

        queries.Add(new CatalogDiscoveryQuery(
            false,
            [CatalogClassification.AnimationGenreId],
            CatalogClassification.JapaneseLanguage,
            options.GeneralAnimeQuota));

        return new CatalogSlice(
            GeneralSliceName,
            ServiceId: null,
            ProviderIds: [],
            IsQuizService: false,
            queries,
            options.MaxDiscoverPages);
    }

    private static CatalogSlice BuildService(CatalogProvider service, CatalogSlicePlanOptions options)
    {
        var providerIds = CatalogVocabulary.Providers
            .Where(provider => string.Equals(provider.ProviderId, service.ProviderId, StringComparison.Ordinal))
            .Select(provider => provider.TmdbId)
            .ToList();

        var queries = new List<CatalogDiscoveryQuery>();

        // The service's catalog, genre by genre. Both presentation media types
        // as the provider files them; anime is a classification, not a
        // discovery type.
        foreach (var genreId in CatalogVocabulary.GenreIds)
        {
            queries.Add(new CatalogDiscoveryQuery(true, [genreId], null, options.ServiceTitlesPerGenre));
            queries.Add(new CatalogDiscoveryQuery(false, [genreId], null, options.ServiceTitlesPerGenre));
        }

        // Per-genre anime: animation + the quiz genre, Japanese original
        // language. Animation itself is skipped here because the any-genre
        // stream below covers it exactly.
        foreach (var genreId in CatalogVocabulary.GenreIds)
        {
            if (genreId == CatalogClassification.AnimationGenreId)
            {
                continue;
            }

            queries.Add(new CatalogDiscoveryQuery(
                true,
                [CatalogClassification.AnimationGenreId, genreId],
                CatalogClassification.JapaneseLanguage,
                options.ServiceTitlesPerGenre));

            queries.Add(new CatalogDiscoveryQuery(
                false,
                [CatalogClassification.AnimationGenreId, genreId],
                CatalogClassification.JapaneseLanguage,
                options.ServiceTitlesPerGenre));
        }

        // Any-genre anime, the equivalent of the general slice's anime quota.
        queries.Add(new CatalogDiscoveryQuery(
            true,
            [CatalogClassification.AnimationGenreId],
            CatalogClassification.JapaneseLanguage,
            options.ServiceTitlesPerGenre));

        queries.Add(new CatalogDiscoveryQuery(
            false,
            [CatalogClassification.AnimationGenreId],
            CatalogClassification.JapaneseLanguage,
            options.ServiceTitlesPerGenre));

        return new CatalogSlice(
            service.ProviderId,
            service.ProviderId,
            providerIds,
            IsQuizService: true,
            queries,
            options.MaxDiscoverPages);
    }

    private static IReadOnlyList<CatalogProvider> BuildQuizServices()
    {
        var services = new List<CatalogProvider>();

        foreach (var provider in CatalogVocabulary.Providers)
        {
            if (provider.VocabId is null)
            {
                continue;
            }

            if (!services.Any(service => string.Equals(service.ProviderId, provider.ProviderId, StringComparison.Ordinal)))
            {
                services.Add(provider);
            }
        }

        return services;
    }
}

/// <summary>
/// The dedupe rule for discovery: the first query to reach a title owns it, and
/// a title reached through five genres is still one title (FR-011).
/// </summary>
public static class CatalogDiscoveryOrder
{
    /// <summary>
    /// Distinct candidates in first-seen order, compared by <see cref="CatalogCandidate.TitleId"/>.
    /// </summary>
    public static IReadOnlyList<CatalogCandidate> Distinct(IEnumerable<CatalogCandidate> candidates)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var distinct = new List<CatalogCandidate>();

        foreach (var candidate in candidates)
        {
            if (seen.Add(candidate.TitleId))
            {
                distinct.Add(candidate);
            }
        }

        return distinct;
    }
}

using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The catalog provider, spoken to over HTTP (research D3, D4, D12, D15).
///
/// Composing a region's pool takes roughly twenty discovery queries plus one
/// enriched query per title — hundreds of upstream calls — which is exactly why
/// nothing on a request's critical path ever calls this (research D10). The
/// visitor's request is answered from a snapshot; this runs behind it.
///
/// Two properties of the provider shape the code:
/// <list type="bullet">
///   <item><b>Availability is only knowable per title.</b> Discovery can filter
///   <i>by</i> a service but cannot say which services carry a title, so the
///   badges come from one enriched call each — folded together with the trailer
///   through <c>append_to_response</c> so it is one call rather than two
///   (research D4).</item>
///   <item><b>Its rate limit is soft and enforced.</b> The batch paces itself
///   below the documented ceiling rather than discovering it, and treats a 429
///   as the batch's end rather than something to retry into (research D16).</item>
/// </list>
/// </summary>
public sealed class TmdbClient : ICatalogProvider
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;
    private readonly TmdbOptions _options;
    private readonly ILogger<TmdbClient> _logger;
    private readonly TimeProvider _time;

    /// <summary>
    /// Serializes outbound calls so the batch cannot outrun the provider's
    /// limit. One instance is used by one refresh, and refreshes are
    /// single-flight, so this is the whole of the pacing.
    /// </summary>
    private readonly SemaphoreSlim _pace = new(1, 1);

    private DateTimeOffset _lastCall = DateTimeOffset.MinValue;

    public TmdbClient(
        HttpClient http,
        IOptions<TmdbOptions> options,
        ILogger<TmdbClient> logger,
        TimeProvider time)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
        _time = time;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CatalogTitle>> FetchAsync(string region, CancellationToken cancellationToken)
    {
        var candidates = new List<Candidate>();
        var seen = new HashSet<(bool IsMovie, int Id)>();

        // One genre at a time, in the quiz's own order, so the pool is built
        // the same way twice (constitution VI).
        foreach (var genreId in CatalogVocabulary.GenreIds)
        {
            await CollectAsync(candidates, seen, isMovie: true, genreId, _options.MoviesPerGenre, cancellationToken);
            await CollectAsync(candidates, seen, isMovie: false, genreId, _options.TvPerGenre, cancellationToken);
        }

        // The anime quota. Animation alone is dominated by Western releases, so
        // without this the quiz's ninth genre would offer a visitor very little
        // that is actually anime (research D3).
        await CollectAsync(
            candidates, seen, isMovie: true, CatalogClassification.AnimationGenreId,
            _options.AnimeQuota, cancellationToken, originalLanguage: CatalogClassification.JapaneseLanguage);

        await CollectAsync(
            candidates, seen, isMovie: false, CatalogClassification.AnimationGenreId,
            _options.AnimeQuota, cancellationToken, originalLanguage: CatalogClassification.JapaneseLanguage);

        var titles = new List<CatalogTitle>(candidates.Count);

        foreach (var candidate in candidates)
        {
            titles.Add(await EnrichAsync(candidate, region, cancellationToken));
        }

        return titles;
    }

    /// <summary>
    /// Walks discovery pages until the genre's quota is met or the provider runs
    /// out, adding everything not already collected.
    /// </summary>
    private async Task CollectAsync(
        List<Candidate> candidates,
        HashSet<(bool IsMovie, int Id)> seen,
        bool isMovie,
        int genreId,
        int quota,
        CancellationToken cancellationToken,
        string? originalLanguage = null)
    {
        var collected = 0;

        for (var page = 1; page <= _options.MaxDiscoverPages && collected < quota; page++)
        {
            var path = DiscoverPath(isMovie, genreId, originalLanguage, page);
            var response = await SendAsync(path, cancellationToken);
            var body = await ReadAsync<DiscoverPage>(response, path, cancellationToken);

            if (body.Results.Count == 0)
            {
                return;
            }

            foreach (var item in body.Results)
            {
                if (collected >= quota)
                {
                    return;
                }

                // The first query to reach a title owns it: the pool is a
                // union, and a title reachable through three genres is still
                // one title (FR-020).
                if (seen.Add((isMovie, item.Id)))
                {
                    candidates.Add(new Candidate(isMovie, item));
                    collected++;
                }
            }

            if (page >= body.TotalPages)
            {
                return;
            }
        }
    }

    /// <summary>
    /// Fetches a title's availability and trailer, and assembles the catalog
    /// title.
    /// </summary>
    private async Task<CatalogTitle> EnrichAsync(Candidate candidate, string region, CancellationToken cancellationToken)
    {
        var path = DetailPath(candidate, region);
        var response = await SendAsync(path, cancellationToken);
        var detail = await ReadAsync<TitleDetail>(response, path, cancellationToken);

        var item = candidate.Item;
        var title = item.DisplayTitle;
        var genres = CatalogVocabulary.MapGenres(item.GenreIds);

        return new CatalogTitle(
            Id: CatalogClassification.BuildTitleId(candidate.IsMovie, item.Id),
            Title: title,
            ReleaseYear: ParseYear(item.ReleaseDate ?? item.FirstAirDate),
            MediaType: CatalogClassification.ResolveMediaType(
                candidate.IsMovie, item.GenreIds, item.OriginalLanguage),
            Genres: genres,
            Synopsis: item.Overview?.Trim() ?? string.Empty,
            Rating: Math.Round(item.VoteAverage, 1),
            VoteCount: item.VoteCount,
            // A series has no runtime: episode lengths are not a title runtime,
            // and reporting the provider's per-episode figure would be a
            // misleading number rather than a missing one (FR-017).
            RuntimeMinutes: candidate.IsMovie ? detail.Runtime : null,
            TrailerUrl: TrailerUrl(detail),
            PosterUrl: PosterUrl(item.PosterPath),
            Availability: Availability(detail, region, title));
    }

    /// <summary>
    /// The services carrying a title in a region, as badges (FR-006, FR-007).
    /// </summary>
    private IReadOnlyList<StreamingAvailability> Availability(TitleDetail detail, string region, string title)
    {
        if (detail.WatchProviders?.Results is not { } byRegion
            || !byRegion.TryGetValue(region, out var inRegion)
            || inRegion is null)
        {
            return [];
        }

        var badges = new List<StreamingAvailability>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        // Subscription first, then free, then ad-supported: how the visitor is
        // most likely to be able to watch it tonight.
        foreach (var providers in new[] { inRegion.Flatrate, inRegion.Free, inRegion.Ads })
        {
            foreach (var provider in providers ?? [])
            {
                if (CatalogVocabulary.DeepLinkFor(provider.ProviderId, title, region) is not { } link)
                {
                    // The template-coverage rule (research D7). Logged as an id
                    // and nothing else, so the gap can be closed by adding a
                    // template — never rendered as a link that goes nowhere.
                    _logger.LogWarning(
                        "Catalog provider {ProviderId} has no search template and was excluded.",
                        provider.ProviderId);

                    continue;
                }

                // Two provider ids can name one service (a regional listing, an
                // ad-supported tier), and one service earns one badge.
                if (CatalogVocabulary.TryGetProvider(provider.ProviderId, out var mapped)
                    && seen.Add(mapped.ProviderId))
                {
                    badges.Add(new StreamingAvailability(mapped.ProviderId, link));
                }
            }
        }

        return badges;
    }

    /// <summary>The first YouTube trailer, when the provider has one (002 FR-008).</summary>
    private static string? TrailerUrl(TitleDetail detail) =>
        detail.Videos?.Results?.FirstOrDefault(video =>
            string.Equals(video.Site, "YouTube", StringComparison.OrdinalIgnoreCase)
            && string.Equals(video.Type, "Trailer", StringComparison.OrdinalIgnoreCase)) is { } trailer
            ? $"https://www.youtube.com/watch?v={trailer.Key}"
            : null;

    /// <summary>
    /// The image CDN URL for a poster, or <c>null</c> when the title has none.
    ///
    /// Absolute, because the browser loads it directly: no credential is
    /// involved and the CDN is built to be hotlinked (FR-001's carve-out).
    /// </summary>
    private string? PosterUrl(string? posterPath) =>
        string.IsNullOrWhiteSpace(posterPath)
            ? null
            : $"{_options.ImageBaseUrl.TrimEnd('/')}/{_options.PosterSize}{posterPath}";

    /// <summary>
    /// A four-digit year, or 0 when the provider has no date.
    ///
    /// Not "the current year": an invented release year would be a claim about
    /// the title that the data does not support, and the card degrades more
    /// honestly without it (FR-017).
    /// </summary>
    private static int ParseYear(string? date) =>
        DateTime.TryParse(date, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.Year
            : 0;

    private string DiscoverPath(bool isMovie, int genreId, string? originalLanguage, int page)
    {
        var query = new List<string>
        {
            $"with_genres={genreId}",
            "sort_by=popularity.desc",

            // Excluded at the source rather than filtered afterwards, so adult
            // titles never enter a snapshot at all (FR-008, research D15).
            "include_adult=false",
            $"language={Uri.EscapeDataString(_options.Language)}",
            $"page={page}",
        };

        if (originalLanguage is not null)
        {
            query.Add($"with_original_language={Uri.EscapeDataString(originalLanguage)}");
        }

        return $"discover/{(isMovie ? "movie" : "tv")}?{string.Join('&', query)}";
    }

    /// <summary>
    /// The enriched title query: availability and videos folded into the detail
    /// call, because the provider bills them as one request either way and one
    /// call per title is half of two (research D4).
    /// </summary>
    private string DetailPath(Candidate candidate, string region) =>
        $"{(candidate.IsMovie ? "movie" : "tv")}/{candidate.Item.Id}"
        + "?append_to_response=watch/providers,videos"
        + $"&language={Uri.EscapeDataString(_options.Language)}"
        + $"&watch_region={Uri.EscapeDataString(region)}";

    /// <summary>
    /// Issues one paced request, treating anything but a 200 as the batch's end.
    /// </summary>
    private async Task<HttpResponseMessage> SendAsync(string path, CancellationToken cancellationToken)
    {
        await PaceAsync(cancellationToken);

        using var request = new HttpRequestMessage(HttpMethod.Get, path);

        // The key travels in a header rather than the query string, so it does
        // not end up in a proxy's access log (research D1). It is never logged
        // here, and no response body is either.
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _options.ApiKey);

        var response = await _http.SendAsync(request, cancellationToken);

        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            // The provider has told us to stop; retrying into a 429 is how a
            // batch turns into a block. The refresh is abandoned whole, and the
            // next stale request will try again (research D16).
            var retryAfter = response.Headers.RetryAfter?.Delta
                ?? (response.Headers.RetryAfter?.Date is { } date ? date - _time.GetUtcNow() : null);

            _logger.LogWarning(
                "Catalog provider rate-limited the refresh; abandoning the batch. RetryAfter={RetryAfter}",
                retryAfter);

            response.Dispose();

            throw new HttpRequestException(
                "The catalog provider rate-limited the request.",
                null,
                HttpStatusCode.TooManyRequests);
        }

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "Catalog provider answered {StatusCode} for the refresh.",
                (int)response.StatusCode);

            response.Dispose();

            throw new HttpRequestException(
                "The catalog provider refused the request.",
                null,
                response.StatusCode);
        }

        return response;
    }

    private async Task<T> ReadAsync<T>(HttpResponseMessage response, string path, CancellationToken cancellationToken)
    {
        using (response)
        {
            var parsed = await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken);

            return parsed ?? throw new HttpRequestException($"The catalog provider returned an empty body for {path}.");
        }
    }

    /// <summary>
    /// Holds the batch below the provider's ceiling: at most
    /// <see cref="TmdbOptions.RequestsPerSecond"/> calls start per second,
    /// measured as a minimum spacing between them.
    /// </summary>
    private async Task PaceAsync(CancellationToken cancellationToken)
    {
        var spacing = TimeSpan.FromSeconds(1.0 / Math.Max(1, _options.RequestsPerSecond));

        await _pace.WaitAsync(cancellationToken);

        try
        {
            var wait = _lastCall + spacing - _time.GetUtcNow();

            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, _time, cancellationToken);
            }

            _lastCall = _time.GetUtcNow();
        }
        finally
        {
            _pace.Release();
        }
    }

    /// <summary>A title the pool has collected, and the discovery record it came from.</summary>
    private sealed record Candidate(bool IsMovie, DiscoverItem Item);

    // -----------------------------------------------------------------------
    // The provider's wire shapes — snake_case, and only the fields this needs.
    // -----------------------------------------------------------------------

    private sealed record DiscoverPage(
        [property: JsonPropertyName("results")] IReadOnlyList<DiscoverItem> Results,
        [property: JsonPropertyName("total_pages")] int TotalPages);

    private sealed record DiscoverItem(
        [property: JsonPropertyName("id")] int Id,
        [property: JsonPropertyName("title")] string? Title,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("genre_ids")] IReadOnlyList<int> GenreIds,
        [property: JsonPropertyName("original_language")] string? OriginalLanguage,
        [property: JsonPropertyName("overview")] string? Overview,
        [property: JsonPropertyName("poster_path")] string? PosterPath,
        [property: JsonPropertyName("vote_average")] double VoteAverage,
        [property: JsonPropertyName("vote_count")] int VoteCount,
        [property: JsonPropertyName("release_date")] string? ReleaseDate,
        [property: JsonPropertyName("first_air_date")] string? FirstAirDate)
    {
        /// <summary>Films carry <c>title</c> and series carry <c>name</c>; neither field means nothing.</summary>
        public string DisplayTitle => (Title ?? Name ?? string.Empty).Trim();
    }

    private sealed record TitleDetail(
        [property: JsonPropertyName("runtime")] int? Runtime,
        [property: JsonPropertyName("watch/providers")] WatchProviders? WatchProviders,
        [property: JsonPropertyName("videos")] VideoList? Videos);

    private sealed record WatchProviders(
        [property: JsonPropertyName("results")] Dictionary<string, RegionProviders?>? Results);

    private sealed record RegionProviders(
        [property: JsonPropertyName("flatrate")] IReadOnlyList<ProviderRef>? Flatrate,
        [property: JsonPropertyName("free")] IReadOnlyList<ProviderRef>? Free,
        [property: JsonPropertyName("ads")] IReadOnlyList<ProviderRef>? Ads);

    private sealed record ProviderRef([property: JsonPropertyName("provider_id")] int ProviderId);

    private sealed record VideoList(
        [property: JsonPropertyName("results")] IReadOnlyList<Video>? Results);

    private sealed record Video(
        [property: JsonPropertyName("key")] string Key,
        [property: JsonPropertyName("site")] string Site,
        [property: JsonPropertyName("type")] string Type);
}

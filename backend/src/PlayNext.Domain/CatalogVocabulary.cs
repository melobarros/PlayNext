using System.Text;

namespace PlayNext.Domain;

/// <summary>
/// One service in the catalog's vocabulary (research D7).
/// </summary>
/// <param name="TmdbId">The provider id TMDB reports this service under.</param>
/// <param name="VocabId">
/// 001's id for the twelve services the quiz offers, or <c>null</c> for a
/// service the quiz does not list — which then takes <c>tmdb:{TmdbId}</c> as
/// its stable identity (FR-010).
/// </param>
/// <param name="DisplayName">The service's name as TMDB reports it.</param>
/// <param name="SearchTemplate">
/// The service's own search URL, with <c>{title}</c> where the query goes and —
/// only for a service that needs it — <c>{region}</c> for the visitor's
/// lowercase country code. Those two are the whole vocabulary; a template
/// naming anything else would ship the braces verbatim in a URL, which
/// <c>Every_template_uses_only_known_placeholders</c> exists to prevent.
/// </param>
public sealed record CatalogProvider(int TmdbId, string? VocabId, string DisplayName, string SearchTemplate)
{
    /// <summary>The id that appears on a badge: a 001 id where one exists, otherwise the pass-through.</summary>
    public string ProviderId => VocabId ?? $"tmdb:{TmdbId}";
}

/// <summary>
/// The translation between the provider's vocabulary and 001's — the feature's
/// other named critical path (constitution V), and a pure Domain rule
/// (constitution VII): no HTTP, no database, no framework, so the mapping can
/// be settled without either.
///
/// It exists because 001's genre and provider identifiers are <b>already stored
/// on visitors' devices</b> under a frozen storage contract. Adopting the
/// provider's numeric ids would orphan every saved preference, so the server
/// translates instead. That is also why the seed tables are written out
/// literally rather than derived: the ids are a contract, and a table that
/// computed them could drift from the devices that hold them.
///
/// Two rules here are less obvious than a plain lookup:
/// <list type="bullet">
///   <item><b>A service the quiz does not offer is still a real place to
///   watch.</b> It gets <c>tmdb:{id}</c> and appears on the badge, because
///   hiding it would make the catalog less true than the data it came from
///   (FR-010).</item>
///   <item><b>A service with no search template is excluded entirely.</b> A
///   badge exists to be tapped (FR-007), so one that cannot be followed is a
///   dead end, and <see cref="Providers"/> is the gate: an id absent from it is
///   absent from every snapshot.</item>
/// </list>
/// </summary>
public static class CatalogVocabulary
{
    /// <summary>
    /// The nine genres the quiz offers, in the order the quiz offers them
    /// (research D6).
    ///
    /// One seed list rather than a map and a separate ordering: the pool is
    /// composed by walking these, and a second list would be free to drift from
    /// the first. The order is what makes a region's pool reproducible from the
    /// same upstream responses (constitution VI).
    /// </summary>
    private static readonly (int TmdbId, string QuizId)[] GenreSeed =
    [
        (28, "action"),
        (35, "comedy"),
        (18, "drama"),
        (27, "horror"),
        (10749, "romance"),
        (878, "sci-fi"),
        (53, "thriller"),
        (16, "animation"),
        (99, "documentary"),
    ];

    /// <summary>The provider's genre ids, in the quiz's own order.</summary>
    public static readonly IReadOnlyList<int> GenreIds =
        GenreSeed.Select(genre => genre.TmdbId).ToList();

    /// <summary>The provider's genre id for each of the nine genres the quiz offers.</summary>
    public static readonly IReadOnlyDictionary<int, string> GenreMap =
        GenreSeed.ToDictionary(genre => genre.TmdbId, genre => genre.QuizId);

    /// <summary>
    /// The provider's genre names, for the genres the quiz does not offer.
    ///
    /// Kept so an unmapped genre can be carried as a readable tag rather than a
    /// bare number. These are stable TMDB vocabulary, not per-request data, so
    /// carrying them costs no upstream call.
    /// </summary>
    private static readonly IReadOnlyDictionary<int, string> GenreNames = new Dictionary<int, string>
    {
        // Shared by both media types.
        [80] = "Crime",
        [10751] = "Family",
        [9648] = "Mystery",
        [37] = "Western",

        // Movie-only.
        [12] = "Adventure",
        [14] = "Fantasy",
        [36] = "History",
        [10402] = "Music",
        [10770] = "TV Movie",
        [10752] = "War",

        // TV-only.
        [10759] = "Action & Adventure",
        [10762] = "Kids",
        [10763] = "News",
        [10764] = "Reality",
        [10765] = "Sci-Fi & Fantasy",
        [10766] = "Soap",
        [10767] = "Talk",
        [10768] = "War & Politics",
    };

    /// <summary>
    /// The services the catalog knows how to link to (research D7).
    ///
    /// The services the quiz offers, their regional and ad-supported tiers
    /// resolved to the same service, and the free/ad-supported services TMDB
    /// commonly reports for Brazil and the United States. Everything else the
    /// provider mentions is excluded from snapshots and logged rather than
    /// rendered as an unfollowable badge.
    ///
    /// <b>Star+ has no row here, and that is deliberate.</b> The service was
    /// discontinued in Latin America and its catalog folded into Disney+; TMDB
    /// stopped listing id 619 altogether, which
    /// <c>CatalogProviderIdsGatedTests</c> caught on 2026-09-28. A row for an
    /// id the provider no longer reports could only produce a badge for a
    /// service that does not exist, so it is gone.
    ///
    /// The <b>visitor-facing</b> half of that is settled on the client, not
    /// here: 001's stored preferences still contain <c>star-plus</c>, and
    /// <c>RETIRED_PROVIDER_SUCCESSORS</c> in
    /// <c>frontend/src/app/core/models/quiz-options.data.ts</c> maps it onto
    /// Disney+ when the deck matches availability. It cannot live in this table
    /// — the server would have to emit a <c>star-plus</c> badge, and that badge
    /// would link to a service that is gone.
    /// </summary>
    public static readonly IReadOnlyList<CatalogProvider> Providers =
    [
        // ── The services the quiz offers ────────────────────────────────────
        new(8, "netflix", "Netflix", "https://www.netflix.com/search?q={title}"),
        new(119, "prime-video", "Prime Video", "https://www.primevideo.com/search?phrase={title}"),
        // Disney+ serves no search page to an anonymous client: every
        // `/search` path tried answers 404 while `/` and `/home` answer 200, so
        // this is a missing route rather than bot-blocking (T035, 2026-09-28).
        // The root is the honest destination — it geo-localizes on its own and
        // carries search one tap away — where a 404 is a dead end.
        new(337, "disney-plus", "Disney Plus", "https://www.disneyplus.com/"),
        // Was 384 until TMDB retired that id. 1899 is now the service's only
        // listing — it used to sit below as a "regional variant" — and both
        // play.max.com and www.max.com 301 to www.hbomax.com, so the template
        // points at the destination rather than spending a redirect on every
        // badge tap. `www.hbomax.com/search` answers 404, but the service's own
        // `/search?q=` route redirects to exactly this URL with the query
        // intact, so this is the destination its own router chooses — the best
        // available, since HBO Max exposes no reachable search page.
        new(1899, "max", "HBO Max", "https://www.hbomax.com/?q={title}"),
        new(350, "apple-tv-plus", "Apple TV Plus", "https://tv.apple.com/search?term={title}"),
        // The one service whose search needs the country in the path: without
        // it `/search/?q=` geo-redirects to `/{region}/search/` and drops the
        // query, landing the visitor on an empty search box. With it, the query
        // survives (T035, 2026-09-28).
        new(531, "paramount-plus", "Paramount Plus", "https://www.paramountplus.com/{region}/search/?q={title}"),
        new(283, "crunchyroll", "Crunchyroll", "https://www.crunchyroll.com/search?q={title}"),
        new(11, "mubi", "MUBI", "https://mubi.com/en/search?query={title}"),
        new(307, "globoplay", "Globoplay", "https://globoplay.globo.com/busca/?q={title}"),
        // Star+ (619) was here. See the summary above: the service is gone and
        // the id with it.
        new(15, "hulu", "Hulu", "https://www.hulu.com/search?q={title}"),
        new(386, "peacock", "Peacock", "https://www.peacocktv.com/search?q={title}"),

        // ── The same services under a second TMDB id ────────────────────────
        // TMDB lists an ad-supported tier or a regional listing separately. It
        // is still that service carrying the title, so it resolves to the same
        // 001 id — otherwise a visitor who picked Netflix would be told a title
        // is unavailable on Netflix while Netflix is streaming it.
        new(1796, "netflix", "Netflix", "https://www.netflix.com/search?q={title}"),
        new(2100, "prime-video", "Prime Video", "https://www.primevideo.com/search?phrase={title}"),

        // ── Services outside the quiz, kept honest (FR-010) ─────────────────
        // `/search/details` is gone; TMDB still lists the service, but the path
        // now answers 404 (T035, 2026-09-28). `/search` is the live one, and it
        // redirects to the visitor's own region on its own.
        new(300, null, "Pluto TV", "https://pluto.tv/en/search?q={title}"),
        new(73, null, "Tubi TV", "https://tubitv.com/search/{title}"),
        new(192, null, "YouTube", "https://www.youtube.com/results?search_query={title}"),
        new(269, null, "Freevee", "https://www.amazon.com/s?k={title}&i=instant-video"),
    ];

    private static readonly IReadOnlyDictionary<int, CatalogProvider> ProvidersById =
        Providers.ToDictionary(provider => provider.TmdbId);

    /// <summary>
    /// The monetization types that mean "the visitor can watch this tonight on
    /// a service they already pay for" (research D5). Rent and buy are
    /// deliberately absent: the quiz asks which services the visitor pays for,
    /// and offering a rental would put back the dead end FR-007 removes.
    /// </summary>
    private static readonly HashSet<string> StreamableMonetizations =
        new(StringComparer.Ordinal) { "flatrate", "free", "ads" };

    /// <summary>
    /// 001's id for a provider genre, or <c>null</c> when the quiz offers no
    /// equivalent.
    /// </summary>
    public static string? ToGenreId(int tmdbGenreId) =>
        GenreMap.TryGetValue(tmdbGenreId, out var genreId) ? genreId : null;

    /// <summary>
    /// Maps a title's provider genres into 001's vocabulary.
    ///
    /// The quiz's own genres come first, then tags for the rest — never a
    /// dropped genre. The client filters on the nine, so the tags are inert for
    /// filtering and exist so a card does not claim a crime thriller is just a
    /// thriller. Order follows the provider's own, which is what makes the
    /// output reproducible from the same response (constitution VI).
    /// </summary>
    public static IReadOnlyList<string> MapGenres(IReadOnlyList<int> tmdbGenreIds)
    {
        var mapped = new List<string>(tmdbGenreIds.Count);
        var tags = new List<string>();

        foreach (var tmdbGenreId in tmdbGenreIds)
        {
            if (ToGenreId(tmdbGenreId) is { } genreId)
            {
                if (!mapped.Contains(genreId, StringComparer.Ordinal))
                {
                    mapped.Add(genreId);
                }
            }
            else if (GenreNames.TryGetValue(tmdbGenreId, out var name))
            {
                var tag = Slug(name);

                if (!tags.Contains(tag, StringComparer.Ordinal))
                {
                    tags.Add(tag);
                }
            }

            // A genre id with neither a mapping nor a name is dropped: there is
            // nothing truthful to call it, and inventing "tmdb:12345" as a
            // genre would put a number on a card.
        }

        mapped.AddRange(tags);

        return mapped;
    }

    /// <summary>
    /// The provider's entry for a service, or <c>false</c> when it has none.
    ///
    /// <c>false</c> is the caller's signal to exclude the service from the
    /// snapshot and log its id — not to invent a link (research D7).
    /// </summary>
    public static bool TryGetProvider(int tmdbProviderId, out CatalogProvider provider) =>
        ProvidersById.TryGetValue(tmdbProviderId, out provider!);

    /// <summary>Whether a monetization type is one the catalog may promise.</summary>
    public static bool IsStreamable(string? monetizationType) =>
        monetizationType is not null && StreamableMonetizations.Contains(monetizationType);

    /// <summary>
    /// The badge's link: the service's own search, with the title encoded into
    /// it — or <c>null</c> for a service this vocabulary cannot address.
    ///
    /// Built here rather than on the client because the templates are mapping
    /// data and belong next to the rest of it: a service that renames a path is
    /// then a one-row fix in one place, reviewed in one pull request.
    ///
    /// <paramref name="region"/> is the visitor's country, and it is lowercased
    /// because every service that wants one in a URL wants it in lowercase
    /// (<c>/br/search/</c>), while ours is stored and compared in uppercase.
    /// A template that does not mention <c>{region}</c> is unaffected by it.
    /// </summary>
    public static string? DeepLinkFor(int tmdbProviderId, string title, string region) =>
        TryGetProvider(tmdbProviderId, out var provider)
            ? provider.SearchTemplate
                .Replace("{title}", Uri.EscapeDataString(title), StringComparison.Ordinal)
                .Replace("{region}", Uri.EscapeDataString(region.ToLowerInvariant()), StringComparison.Ordinal)
            : null;

    /// <summary>
    /// The placeholders a template is allowed to use.
    ///
    /// Named here rather than left inside <see cref="DeepLinkFor"/> so the
    /// coverage test can assert against the same list the substitution uses: a
    /// test with its own copy would agree with itself while the substitution
    /// drifted.
    /// </summary>
    public static readonly IReadOnlyList<string> TemplatePlaceholders = ["{title}", "{region}"];

    /// <summary>
    /// A lowercase, dash-separated tag from a genre name: "Sci-Fi &amp; Fantasy"
    /// becomes <c>sci-fi-and-fantasy</c>.
    ///
    /// The ampersand becomes a word rather than disappearing, so "Action &amp;
    /// Adventure" cannot collide with "Action Adventure" and — more to the point
    /// — so neither can collide with one of the quiz's own ids.
    /// </summary>
    private static string Slug(string name)
    {
        var builder = new StringBuilder(name.Length);

        foreach (var character in name.Replace("&", " and ", StringComparison.Ordinal))
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }

        return builder.ToString().TrimEnd('-');
    }
}

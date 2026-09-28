namespace PlayNext.Domain;

/// <summary>
/// The two rules that turn a provider record into a catalog title: which of the
/// quiz's three media types it is (FR-016), and what its identity is
/// (research D9).
///
/// Pure and static, like <see cref="CatalogVocabulary"/> and for the same
/// reason: both rules are named critical paths (constitution V) and both must
/// be settle-able without HTTP, a database, or a host.
/// </summary>
public static class CatalogClassification
{
    /// <summary>The provider's Animation genre, the first half of the anime rule.</summary>
    public const int AnimationGenreId = 16;

    /// <summary>ISO 639-1 for Japanese, the second half of the anime rule.</summary>
    public const string JapaneseLanguage = "ja";

    /// <summary>
    /// Which of the quiz's three media types a title is.
    ///
    /// Anime is a <b>conjunction</b>: the title is animation <i>and</i> its
    /// original language is Japanese. Either half alone is wrong in a way that
    /// shows on the screen — animation alone would file every Disney film under
    /// anime, and Japanese alone would file every Japanese drama there. The
    /// classification applies to this field only; identity keeps the type the
    /// provider actually filed the title under (see <see cref="BuildTitleId"/>).
    ///
    /// A missing language is not evidence of Japanese: the provider omits the
    /// field on some records, and defaulting it to Japanese would mislabel
    /// them.
    /// </summary>
    public static CatalogMediaType ResolveMediaType(
        bool isMovie,
        IReadOnlyList<int> tmdbGenreIds,
        string? originalLanguage)
    {
        var isAnime = tmdbGenreIds.Contains(AnimationGenreId)
            && string.Equals(originalLanguage, JapaneseLanguage, StringComparison.OrdinalIgnoreCase);

        if (isAnime)
        {
            return CatalogMediaType.Anime;
        }

        return isMovie ? CatalogMediaType.Movie : CatalogMediaType.Tv;
    }

    /// <summary>
    /// A title's stable identity: <c>tmdb:{movie|tv}:{id}</c>.
    ///
    /// The type inside the id is the <b>underlying</b> one — never the
    /// anime-classified value — so identity does not move if the classification
    /// rule is ever revisited, and a title already in a visitor's watchlist
    /// stays the same title. The type is part of the id because the provider's
    /// ids are unique only within a type: film 1399 and series 1399 are two
    /// different things.
    /// </summary>
    public static string BuildTitleId(bool isMovie, int tmdbId) =>
        $"tmdb:{(isMovie ? "movie" : "tv")}:{tmdbId}";
}

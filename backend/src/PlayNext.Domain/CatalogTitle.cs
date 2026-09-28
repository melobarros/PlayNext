namespace PlayNext.Domain;

/// <summary>
/// A title as the catalog serves it (data-model.md, "CatalogTitle").
///
/// The shape is deliberately the one the deck and the watchlist have consumed
/// since 002 (<c>frontend/src/app/core/models/media-title.ts</c>): the server
/// produces what the client already renders, so no screen changes shape because
/// the catalog became real (FR-009).
///
/// Every optional field is optional because the provider can omit it, and the
/// provider omitting something is normal rather than an error — a title with no
/// trailer, no poster, no runtime or no availability still renders, degrading
/// per FR-017 as the client already does for the bundled sample.
/// </summary>
/// <param name="Id">
/// <c>tmdb:{movie|tv}:{providerId}</c>. The media type inside the id is the
/// <b>underlying</b> one, never the anime-classified value, so identity is
/// stable even if the classification rule is revisited (research D9). It is
/// also the only form of identity: name plus year is not identity, because
/// remakes and same-named series exist (spec edge case).
/// </param>
/// <param name="Title">The display name, in English (clarified).</param>
/// <param name="ReleaseYear">
/// Four digits, from <c>release_date</c> (movie) or <c>first_air_date</c> (TV).
/// A title the provider has no date for carries 0 rather than an invented year
/// — the card degrades.
/// </param>
/// <param name="MediaType">Movie, TV, or anime per the FR-016 rule.</param>
/// <param name="Genres">
/// 001's genre ids where a mapping exists, plus tags for the provider's genres
/// that have none (research D6). May be empty. The client's filter matches only
/// the nine quiz ids, so the extra tags are inert for filtering and exist to
/// keep the card truthful.
/// </param>
/// <param name="Synopsis">May be empty (FR-017).</param>
/// <param name="Rating">0–10, one decimal, from <c>vote_average</c>.</param>
/// <param name="VoteCount">Non-negative, from <c>vote_count</c>.</param>
/// <param name="RuntimeMinutes">
/// Movies only. Absent for TV, where episode lengths are not a title runtime —
/// the client renders the absence rather than a misleading number (FR-017).
/// </param>
/// <param name="TrailerUrl">
/// The first YouTube trailer, when the provider has one (002 FR-008).
/// </param>
/// <param name="PosterUrl">
/// The provider's image CDN URL, when the title has artwork (FR-001's
/// clarified carve-out: static media, no credential, loaded by the browser
/// directly). Absent → the client's existing CSS placeholder.
/// </param>
/// <param name="Availability">
/// Every service carrying this title in this region. Empty is normal, not an
/// error — it means the visitor's region has no flatrate/free/ads home for it.
/// </param>
public sealed record CatalogTitle(
    string Id,
    string Title,
    int ReleaseYear,
    CatalogMediaType MediaType,
    IReadOnlyList<string> Genres,
    string Synopsis,
    double Rating,
    int VoteCount,
    int? RuntimeMinutes,
    string? TrailerUrl,
    string? PosterUrl,
    IReadOnlyList<StreamingAvailability> Availability);

/// <summary>
/// The catalog's three-way media vocabulary — the quiz's own choice, made real
/// (FR-016).
///
/// It is a distinct type from anything the client sends: this one is only ever
/// produced by the server, and the distinction between <see cref="Tv"/> and
/// <see cref="Anime"/> is a rule about the provider's data rather than a value
/// anyone stores.
/// </summary>
public enum CatalogMediaType
{
    /// <summary>A film.</summary>
    Movie,

    /// <summary>A series, as the provider classifies it.</summary>
    Tv,

    /// <summary>Animation with a Japanese original language (FR-016) — overrides the underlying type in this field only.</summary>
    Anime,
}

/// <summary>
/// Translation between <see cref="CatalogMediaType"/> and the wire vocabulary
/// (<c>movie</c> | <c>tv</c> | <c>anime</c>).
///
/// These three strings are already the client's own vocabulary — the quiz offers
/// them and 002 stores them — so the API must not invent a fourth spelling. One
/// place, covered by tests, per the same reasoning as
/// <see cref="InteractionStates"/>.
/// </summary>
public static class CatalogMediaTypes
{
    private static readonly Dictionary<CatalogMediaType, string> ToWireNames = new()
    {
        [CatalogMediaType.Movie] = "movie",
        [CatalogMediaType.Tv] = "tv",
        [CatalogMediaType.Anime] = "anime",
    };

    private static readonly Dictionary<string, CatalogMediaType> FromWireNames =
        ToWireNames.ToDictionary(entry => entry.Value, entry => entry.Key, StringComparer.Ordinal);

    /// <summary>The wire name, e.g. <c>anime</c>.</summary>
    public static string ToWire(CatalogMediaType mediaType) => ToWireNames[mediaType];

    /// <summary>
    /// The media type a wire name stands for, or <c>null</c> when it names none
    /// of the three.
    ///
    /// The reverse direction exists because a snapshot is stored in the same
    /// vocabulary it is served in (data-model.md, <c>PayloadJson</c>): a stored
    /// payload that spelled the media type differently from the response would
    /// be a second vocabulary for one concept, free to drift from this one
    /// (constitution VII).
    ///
    /// Nullable rather than throwing, because the caller is reading bytes that
    /// some other version of this code may have written. "Not a value I know" is
    /// a fact about the payload, and the caller decides what it means — for a
    /// snapshot, it means the payload is not one.
    /// </summary>
    public static CatalogMediaType? FromWire(string? wireName) =>
        wireName is not null && FromWireNames.TryGetValue(wireName, out var mediaType) ? mediaType : null;
}

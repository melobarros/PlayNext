using System.Text.RegularExpressions;

namespace PlayNext.Domain;

/// <summary>
/// The catalog read request, normalized and validated (contracts/catalog-api.md).
///
/// Every dimension is an OR within itself and the dimensions are ANDed, which
/// is the same semantics the client's own filters already have — so the
/// server's narrowing can only remove candidates the client would have removed
/// anyway (FR-027).
/// </summary>
/// <param name="Services">Canonical service ids; unknown but well-formed values are valid and select nothing.</param>
/// <param name="Genres">Genre ids; unknown but well-formed values are valid and select nothing.</param>
/// <param name="MediaTypes">The three presentation media types.</param>
/// <param name="Ids">Exact title ids for a batch lookup.</param>
public sealed record CatalogPoolQuery(
    IReadOnlyList<string> Services,
    IReadOnlyList<string> Genres,
    IReadOnlyList<CatalogMediaType> MediaTypes,
    IReadOnlyList<string> Ids)
{
    public static readonly CatalogPoolQuery Empty = new([], [], [], []);

    public bool HasFilters => Services.Count > 0 || Genres.Count > 0 || MediaTypes.Count > 0;

    public bool HasIds => Ids.Count > 0;

    /// <summary>
    /// The no-filter request: the general pool, in its stable pool order.
    /// The client's default deck load is this shape.
    /// </summary>
    public bool IsGeneral => !HasFilters && !HasIds;

    /// <summary>
    /// A stable key for the read cache. Sorted within each dimension and fixed
    /// across dimensions, so the same set of filters hits the same entry
    /// regardless of the order they arrived in.
    /// </summary>
    public string CacheKey
    {
        get
        {
            var services = string.Join(',', Services.Order(StringComparer.Ordinal));
            var genres = string.Join(',', Genres.Order(StringComparer.Ordinal));
            var mediaTypes = string.Join(',', MediaTypes.Select(CatalogMediaTypes.ToWire).Order(StringComparer.Ordinal));
            var ids = string.Join(',', Ids.Order(StringComparer.Ordinal));

            return $"s={services};g={genres};m={mediaTypes};i={ids}";
        }
    }
}

/// <summary>The outcome of parsing the optional request parameters.</summary>
/// <param name="Query">The normalized query, when no error was found.</param>
/// <param name="ErrorCode">The contract's error code, or <c>null</c>.</param>
/// <param name="Error">One human-readable line for the errors array.</param>
public sealed record CatalogPoolQueryResult(
    CatalogPoolQuery? Query,
    string? ErrorCode,
    string? Error)
{
    public static CatalogPoolQueryResult Ok(CatalogPoolQuery query) => new(query, null, null);

    public static CatalogPoolQueryResult Invalid(string code, string error) => new(null, code, error);

    public bool IsValid => Query is not null;
}

/// <summary>
/// Normalization and validation of the four optional catalog parameters.
///
/// <b>Well-formed but unknown values are valid.</b> Services and genres are data
/// (FR-021), so a value that is not in today's vocabulary selects nothing rather
/// than returning a 400; only a syntactically impossible value does. That is
/// also why the regexes live here, in the Domain, next to the vocabulary rather
/// than in the endpoint: the contract has one spelling, tested once.
/// </summary>
public static class CatalogPoolQueryParser
{
    public const int MaxVocabularyValueLength = 64;

    private static readonly Regex ServicePattern = new(
        @"^(?:[a-z0-9][a-z0-9-]{0,63}|tmdb:[0-9]{1,10})$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex GenrePattern = new(
        @"^[a-z0-9][a-z0-9-]{0,63}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex TitleIdPattern = new(
        @"^tmdb:(?:movie|tv):[0-9]{1,10}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Parses all four parameters. Returns the first error found; the caller
    /// turns it into the contract's 400 body.
    /// </summary>
    public static CatalogPoolQueryResult Parse(
        string? services,
        string? genres,
        string? mediaTypes,
        string? ids,
        int maxIdsPerRequest)
    {
        var parsedServices = Split(services);

        foreach (var service in parsedServices)
        {
            if (!ServicePattern.IsMatch(service))
            {
                return CatalogPoolQueryResult.Invalid(
                    "invalid-service",
                    "services must be lowercase ids of 1-64 characters or tmdb:{providerId}");
            }
        }

        var parsedGenres = Split(genres);

        foreach (var genre in parsedGenres)
        {
            if (!GenrePattern.IsMatch(genre))
            {
                return CatalogPoolQueryResult.Invalid(
                    "invalid-genre",
                    "genres must be lowercase ids of 1-64 characters");
            }
        }

        var parsedMediaTypes = new List<CatalogMediaType>();

        foreach (var mediaType in Split(mediaTypes))
        {
            if (CatalogMediaTypes.FromWire(mediaType) is not { } parsed)
            {
                return CatalogPoolQueryResult.Invalid(
                    "invalid-media-type",
                    "mediaTypes must be movie, tv, or anime");
            }

            if (!parsedMediaTypes.Contains(parsed))
            {
                parsedMediaTypes.Add(parsed);
            }
        }

        var parsedIds = Split(ids);

        if (parsedIds.Count > maxIdsPerRequest)
        {
            return CatalogPoolQueryResult.Invalid(
                "too-many-ids",
                $"ids must contain at most {maxIdsPerRequest} values");
        }

        foreach (var id in parsedIds)
        {
            if (!TitleIdPattern.IsMatch(id))
            {
                return CatalogPoolQueryResult.Invalid(
                    "invalid-title-id",
                    "ids must be tmdb:{movie|tv}:{providerId}");
            }
        }

        return CatalogPoolQueryResult.Ok(new CatalogPoolQuery(
            Distinct(parsedServices),
            Distinct(parsedGenres),
            parsedMediaTypes,
            Distinct(parsedIds)));
    }

    /// <summary>
    /// Comma-separated, trimmed, empty values ignored. Order is preserved on the
    /// way in; deduplication follows.
    /// </summary>
    private static List<string> Split(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(item => item.Length > 0)
                .ToList();

    private static IReadOnlyList<string> Distinct(List<string> values)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var distinct = new List<string>(values.Count);

        foreach (var value in values)
        {
            if (seen.Add(value))
            {
                distinct.Add(value);
            }
        }

        return distinct;
    }
}

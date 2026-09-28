using PlayNext.Domain;

namespace PlayNext.Application.Contracts;

/// <summary>
/// A region's catalog as the use case hands it around: the titles plus when
/// they were retrieved.
/// </summary>
/// <remarks>
/// Distinct from <see cref="CatalogResponse"/> on purpose. This one is the
/// application's value — it carries domain titles and the instant the batch
/// succeeded, which is what the staleness bound is measured against. The wire
/// shape is the API's to build, so a change to the JSON never reaches the cache
/// or the store.
/// </remarks>
public sealed record CatalogSnapshot(
    string Region,
    DateTimeOffset FetchedAt,
    IReadOnlyList<CatalogTitle> Titles);

/// <summary>
/// The outcome of serving a region: a snapshot to send, or the honest "nothing
/// has been retrieved yet".
/// </summary>
/// <remarks>
/// Shaped after <see cref="SyncResult"/>: a state the endpoint turns into a
/// status code, not an exception. There are two states rather than several
/// because a malformed region is refused before this point — by the time a
/// caller holds a <see cref="CatalogResult"/>, the region is known good.
/// </remarks>
public sealed record CatalogResult(CatalogStatus Status, CatalogSnapshot? Snapshot)
{
    /// <summary>There is a snapshot to serve — fresh or stale (FR-012).</summary>
    public static CatalogResult Ready(CatalogSnapshot snapshot) => new(CatalogStatus.Ready, snapshot);

    /// <summary>
    /// Nothing has ever been retrieved for this region. A refresh has been
    /// started; the visitor's next load gets titles (FR-014).
    /// </summary>
    public static CatalogResult NotReady() => new(CatalogStatus.NotReady, null);

    public bool IsReady => Status == CatalogStatus.Ready;
}

public enum CatalogStatus
{
    /// <summary>A snapshot is available.</summary>
    Ready,

    /// <summary>No snapshot has ever been retrieved; a refresh is under way.</summary>
    NotReady,
}

// ---------------------------------------------------------------------------
// The wire shape (contracts/catalog.md)
// ---------------------------------------------------------------------------

/// <summary>
/// The payload of <c>GET /api/catalog</c>: the whole region pool at full depth
/// (FR-020), which is why there is no detail endpoint to go with it.
/// </summary>
public sealed record CatalogResponse(
    string Region,
    DateTimeOffset FetchedAt,
    IReadOnlyList<TitleDto> Titles);

/// <summary>
/// One title on the wire. Field for field the shape the deck and the watchlist
/// have consumed since 002 — the server produces what the client already
/// renders, so no screen changed shape because the catalog became real (FR-009).
/// </summary>
public sealed record TitleDto(
    string Id,
    string Title,
    int ReleaseYear,
    string MediaType,
    IReadOnlyList<string> Genres,
    string Synopsis,
    double Rating,
    int VoteCount,
    int? RuntimeMinutes,
    string? TrailerUrl,
    string? PosterUrl,
    IReadOnlyList<AvailabilityDto> Availability);

/// <summary>
/// One service carrying the title, with the link that opens it (FR-007).
/// </summary>
public sealed record AvailabilityDto(string ProviderId, string DeepLinkUrl);

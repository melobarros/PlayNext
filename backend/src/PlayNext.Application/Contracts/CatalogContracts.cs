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

// ---------------------------------------------------------------------------
// Feature 008 — storage selection, versions, and refresh runs
// ---------------------------------------------------------------------------

/// <summary>Which storage serves a catalog read (FR-007).</summary>
public enum CatalogSource
{
    /// <summary>The 005 JSON snapshot — the rollback path.</summary>
    Snapshot,

    /// <summary>The versioned normalized tables.</summary>
    Normalized,
}

/// <summary>
/// The read policy, as values: the source switch, the staleness bound, and the
/// retention cutoff. Passed in rather than read from Infrastructure's options
/// object, so the Application layer keeps its dependency direction
/// (constitution VII).
/// </summary>
public sealed record CatalogQueryPolicy(
    CatalogSource Source,
    TimeSpan Staleness,
    TimeSpan Retention);

/// <summary>
/// A visible catalog version as readers need it: the id to pin every query to,
/// the served timestamp, and the retention gate.
/// </summary>
public sealed record CatalogVersionRef(
    Guid Id,
    string Region,
    DateTimeOffset FetchedAt,
    DateTimeOffset? LatestObservedAt);

/// <summary>Which process created a version.</summary>
public enum CatalogVersionSource
{
    Refresh,
    Migration,
}

/// <summary>
/// The outcome of starting a build. <see cref="AlreadyPromoted"/> is the
/// idempotent-migration case (the same snapshot timestamp is already active);
/// <see cref="Outdated"/> is a build newer than the one being requested, which
/// must be left alone (research D6).
/// </summary>
public sealed record CatalogBuildStart(Guid VersionId, bool AlreadyPromoted, bool Outdated);

/// <summary>One availability entry in a version's composition.</summary>
public sealed record CatalogAvailabilityRow(
    string ServiceId,
    string Monetization,
    string DeepLinkUrl,
    int Position,
    DateTimeOffset LastObservedAt);

/// <summary>
/// One title in a version's composition, with everything the wire shape needs
/// and nothing it does not. Readers map it; writers store it.
/// </summary>
public sealed record CatalogTitleRow(
    string TitleId,
    string Name,
    int ReleaseYear,
    CatalogMediaType MediaType,
    IReadOnlyList<string> Genres,
    string Synopsis,
    double Rating,
    int VoteCount,
    int? RuntimeMinutes,
    string? TrailerUrl,
    string? PosterUrl,
    double Popularity,
    bool InGeneralPool,
    int PoolPosition,
    DateTimeOffset LastObservedAt,
    IReadOnlyList<CatalogAvailabilityRow> Availability)
{
    /// <summary>The wire title, with genres and availability in their stored order.</summary>
    public CatalogTitle ToCatalogTitle() => new(
        TitleId,
        Name,
        ReleaseYear,
        MediaType,
        Genres,
        Synopsis,
        Rating,
        VoteCount,
        RuntimeMinutes,
        TrailerUrl,
        PosterUrl,
        Availability
            .OrderBy(entry => entry.Position)
            .Select(entry => new StreamingAvailability(entry.ServiceId, entry.DeepLinkUrl))
            .ToList());
}

/// <summary>A service observed during a refresh, to be upserted by the writer.</summary>
public sealed record CatalogServiceRow(
    string Id,
    string DisplayName,
    string? SearchTemplate,
    bool IsQuizService,
    int Position);

/// <summary>
/// A complete version composition: every row, in stable order, ready to write.
/// </summary>
public sealed record CatalogBuild(
    string Region,
    DateTimeOffset FetchedAt,
    IReadOnlyList<CatalogServiceRow> Services,
    IReadOnlyList<CatalogTitleRow> Titles);

// ---------------------------------------------------------------------------
// Provider observations (feature 008)
// ---------------------------------------------------------------------------

/// <summary>
/// A title after its single enrichment call: the wire title, every offer the
/// provider reported, and the region's watch page when one exists.
///
/// A title discovered by six services is enriched once and its offers are the
/// complete answer for all six (FR-012, research D4).
/// </summary>
public sealed record CatalogTitleObservation(
    CatalogCandidate Candidate,
    CatalogTitle Title,
    IReadOnlyList<CatalogOffer> Offers,
    string? RegionWatchLink);

// ---------------------------------------------------------------------------
// Refresh runs (contracts/catalog-refresh.md)
// ---------------------------------------------------------------------------

public enum CatalogRunKind
{
    Refresh,
    Migration,
}

public enum CatalogRunMode
{
    Configured,
    Normalized,
    Snapshot,
}

public enum CatalogRunStatus
{
    Running,
    Succeeded,
    PartiallyFailed,
    Failed,
    Abandoned,
}

/// <summary>Per-slice (or per-migration) counts. Never contains title data.</summary>
public sealed record CatalogRunCounts(
    int Discovered = 0,
    int Fresh = 0,
    int Carried = 0,
    int Skipped = 0,
    int Enriched = 0,
    int AvailabilityEntries = 0,
    int Genres = 0);

/// <summary>How a run ended: terminal status, promoted version, and sanitized detail.</summary>
public sealed record CatalogRunOutcome(
    CatalogRunStatus Status,
    Guid? VersionId,
    IReadOnlyDictionary<string, CatalogRunCounts> Counts,
    IReadOnlyDictionary<string, string> Failures,
    string? Error);

/// <summary>The stored shape of a run, as the status endpoint reads it.</summary>
public sealed record CatalogRunSummary(
    string Region,
    CatalogRunKind Kind,
    CatalogRunMode? Mode,
    CatalogRunStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    Guid? VersionId,
    IReadOnlyDictionary<string, CatalogRunCounts>? Counts,
    IReadOnlyDictionary<string, string>? Failures);

/// <summary>The wire shape of <c>GET /api/catalog/refresh/status</c>.</summary>
public sealed record CatalogRunStatusResponse(
    string Region,
    string Kind,
    string? Mode,
    string Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    double? DurationSeconds,
    Guid? VersionId,
    IReadOnlyDictionary<string, CatalogRunCounts>? Counts,
    IReadOnlyDictionary<string, string>? Failures);

/// <summary>What a purge did, for the run log and for tests.</summary>
public sealed record CatalogRetentionOutcome(
    int DeletedTitles,
    int ArchivedTitles,
    int DeletedArchiveRows);

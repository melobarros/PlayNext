namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The catalog provider configuration, bound from the <c>Tmdb</c> configuration
/// section (research D1, D3, D4, D12).
///
/// Held as an options object rather than read from <c>IConfiguration</c> at each
/// use, for the same reason <c>JwtOptions</c> is: the credential resolves once,
/// at startup. <see cref="ApiKey"/> is the value the constitution keeps out of
/// client code and out of logs — it lives in user-secrets locally and App
/// Settings / Key Vault on Azure, and this object is the only place the rest of
/// the code reads it from.
/// </summary>
public sealed class TmdbOptions
{
    /// <summary>The configuration section these bind from.</summary>
    public const string SectionName = "Tmdb";

    /// <summary>
    /// The TMDB <b>API Read Access Token</b>, sent as <c>Authorization: Bearer</c>
    /// on every upstream call (research D1). Never logged, never returned, never
    /// bundled.
    ///
    /// The property keeps the name <c>ApiKey</c> because
    /// <c>Tmdb:ApiKey</c> is the setting operators have already configured; what
    /// it holds is the Read Access Token, not the 32-character v3 API key. The
    /// two are different credentials and TMDB's docs put only the token in this
    /// header — the v3 key belongs in a <c>?api_key=</c> query string, which this
    /// client deliberately never sends, so a stale key cannot mask a rejected
    /// token.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>
    /// The API root. Overridable so tests can point at a stub host and so the
    /// outage drill can point at an unreachable one (research D18) — the
    /// property exists for that seam rather than for a second real environment.
    /// </summary>
    public string BaseUrl { get; set; } = "https://api.themoviedb.org/3";

    /// <summary>
    /// <see cref="BaseUrl"/> as the <c>HttpClient</c>'s base address.
    ///
    /// The trailing slash is not cosmetic. Relative resolution treats the last
    /// segment of a base address as a file name and replaces it, so
    /// <c>.../3</c> plus <c>discover/movie</c> resolves to
    /// <c>.../discover/movie</c> — dropping the API version and asking for an
    /// endpoint that does not exist. Terminating the base here means no caller
    /// has to remember.
    /// </summary>
    public Uri BaseAddress => new($"{BaseUrl.TrimEnd('/')}/");

    /// <summary>
    /// The image CDN root. Poster paths are relative, so the absolute URL is
    /// this plus a size segment plus the title's <c>poster_path</c> (D12).
    /// </summary>
    public string ImageBaseUrl { get; set; } = "https://image.tmdb.org/t/p";

    /// <summary>
    /// The poster size segment. One size serves the card and the watchlist
    /// thumbnail alike (research D12).
    /// </summary>
    public string PosterSize { get; set; } = "w500";

    /// <summary>
    /// How old a snapshot may be before it is considered stale (FR-004). A stale
    /// snapshot is still served — the refresh happens behind the response
    /// (research D10) — so this bounds freshness, not availability.
    /// </summary>
    public TimeSpan Staleness { get; set; } = TimeSpan.FromHours(24);

    /// <summary>
    /// How long a snapshot may be <b>kept at all</b>, stale-but-served or not.
    ///
    /// This is not a freshness policy — <see cref="Staleness"/> is that, and it
    /// only ever decides when to refresh behind a response. This is the ceiling
    /// the provider's terms impose: §1.C of TMDB's API Terms of Use prohibits
    /// caching their data "for longer than 6 months", and a snapshot past it may
    /// neither be served nor retained (2026-09-28).
    ///
    /// <b>180 days, and the number is chosen to be provably inside the term.</b>
    /// "Six months" is not a fixed count of days — the shortest six consecutive
    /// calendar months (February through July) is 181 — so a day count below 181
    /// is always fewer than six months, whatever the calendar is doing. A
    /// ceiling of exactly 180 days therefore cannot be the reason a snapshot
    /// outlives the licence, which a "six months" expressed as 183 days could.
    ///
    /// Crossing it is a real visitor-visible event: a region nobody has visited
    /// in six months answers "not ready" and starts a retrieval, instead of
    /// serving titles from before the term. That is the intended trade — the
    /// deck's degrade-to-cached promise (FR-013) yields at the ceiling, because
    /// what it would otherwise serve is data we are not allowed to keep.
    /// </summary>
    public TimeSpan MaxCacheAge { get; set; } = TimeSpan.FromDays(180);

    /// <summary>
    /// How many movies each quiz genre contributes to the pool (research D3).
    ///
    /// A tuning parameter, not a contract: SC-001 is "at least twenty titles for
    /// one genre plus the visitor's own services", and this is the lever that
    /// guarantees depth in every genre rather than only the popular ones.
    ///
    /// <b>Raised from 30 to 60 on 2026-09-28, on measurement rather than
    /// intuition.</b> At 30 the deepest realistic selection — Netflix, Prime
    /// Video, Disney+ and HBO Max — still missed SC-001 in two genres (horror
    /// 15, documentary 17). At 60 the thinnest genre for a three-service
    /// selection is horror at 23, so the criterion is met for every selection of
    /// three or more services. The pool went 540 titles → 916 and the response
    /// 382 KB → 635 KB raw, 114 KB → 186 KB brotli, which is the whole cost of
    /// this change and the reason it is not higher: no quota makes a
    /// single-service selection reach twenty, because the ceiling there is what
    /// that one service carries in the region, not what we ask for. The table is
    /// in quickstart.md.
    /// </summary>
    public int MoviesPerGenre { get; set; } = 60;

    /// <summary>How many TV titles each quiz genre contributes (research D3).</summary>
    public int TvPerGenre { get; set; } = 60;

    /// <summary>
    /// How many anime titles the pool carries (research D3): the ninth genre's
    /// depth comes from a dedicated query rather than from the animation quota,
    /// which is dominated by Western animation.
    /// </summary>
    public int AnimeQuota { get; set; } = 60;

    /// <summary>
    /// How many upstream calls per second the refresh batch may issue. TMDB's
    /// soft limit is around 40 rps and a 429 carries <c>Retry-After</c>; staying
    /// under it deliberately is cheaper than discovering the limit (research D4).
    /// </summary>
    public int RequestsPerSecond { get; set; } = 30;

    /// <summary>
    /// How many pages of a discover query the batch may walk before giving up on
    /// the quota. TMDB's discover pages hold 20 results, so the default covers
    /// the default quotas with room to spare — it exists to bound a region whose
    /// catalog is thin (a filter combination that matches almost nothing) rather
    /// than to limit a healthy one.
    /// </summary>
    public int MaxDiscoverPages { get; set; } = 5;

    /// <summary>Metadata language, requested explicitly (clarified: English everywhere).</summary>
    public string Language { get; set; } = "en-US";
}

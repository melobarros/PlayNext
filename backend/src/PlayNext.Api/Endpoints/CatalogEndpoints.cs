using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using PlayNext.Api.Contracts;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Domain;
using PlayNext.Infrastructure.Catalog;

namespace PlayNext.Api.Endpoints;

/// <summary>
/// The catalog surface (contracts/catalog-api.md, contracts/catalog-refresh.md).
///
/// Two audiences, deliberately separated:
/// <list type="bullet">
///   <item><c>GET /api/catalog</c> is the anonymous visitor path — one payload,
///   four optional filters, and no session. Nothing here reads visitor data, so
///   there is nothing for a session to protect (constitution III).</item>
///   <item><c>POST /api/catalog/refresh</c> and its status route are the
///   operator surface, mapped only when <c>Catalog:AdminToken</c> is configured:
///   a disabled feature must return the ordinary 404, not advertise itself.</item>
/// </list>
///
/// Like the other endpoint files, this one translates and decides nothing. The
/// read policy is <see cref="CatalogQueryService"/>'s; the refresh decision is
/// the refresher's.
/// </summary>
public static class CatalogEndpoints
{
    private const string AdminTokenHeader = "X-PlayNext-Admin-Token";

    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/catalog", GetAsync);

        // Mapped at startup from the configured value. If the token is absent,
        // the routes do not exist — the API answers its normal 404, exactly as
        // if the feature were not deployed.
        var adminToken = routes.ServiceProvider
            .GetRequiredService<IOptions<CatalogOptions>>()
            .Value
            .AdminToken;

        if (!string.IsNullOrWhiteSpace(adminToken))
        {
            routes.MapPost("/api/catalog/refresh", StartRefresh);
            routes.MapGet("/api/catalog/refresh/status", GetRefreshStatusAsync);
        }

        return routes;
    }

    /// <summary>
    /// <c>GET /catalog?region=BR&amp;services=…&amp;genres=…&amp;mediaTypes=…&amp;ids=…</c>
    /// — the visitor's pool, or an honest answer about why it is not there yet.
    /// </summary>
    private static async Task<IResult> GetAsync(
        string? region,
        string? services,
        string? genres,
        string? mediaTypes,
        string? ids,
        CatalogQueryService queries,
        IOptions<CatalogOptions> options,
        CancellationToken cancellationToken)
    {
        // Validated before anything else, and strictly: a malformed region must
        // not reach the policy, because reaching it would start a batch of
        // hundreds of upstream calls on the strength of a typo.
        if (!CatalogRegion.IsWellFormed(region))
        {
            return Results.Json(
                new ErrorResponse("invalid-region", ["region must be an ISO 3166-1 alpha-2 code"]),
                statusCode: StatusCodes.Status400BadRequest);
        }

        var parsed = CatalogPoolQueryParser.Parse(
            services,
            genres,
            mediaTypes,
            ids,
            options.Value.MaxIdsPerRequest);

        if (!parsed.IsValid)
        {
            return Results.Json(
                new ErrorResponse(parsed.ErrorCode!, [parsed.Error!]),
                statusCode: StatusCodes.Status400BadRequest);
        }

        var result = await queries.GetAsync(region!, parsed.Query!, cancellationToken);

        if (result.Snapshot is not { } snapshot)
        {
            // A retrieval has been started; the visitor's next load gets titles
            // (FR-014). The status is distinct from an empty 200 on purpose:
            // an empty array is a catalog that has nothing in it, which the
            // client would cache as though it were the catalog.
            return Results.Json(
                new ErrorResponse(
                    "catalog-not-ready",
                    ["The catalog has not been retrieved yet. Try again shortly."]),
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(ToResponse(snapshot));
    }

    /// <summary>
    /// <c>POST /catalog/refresh?region=BR&amp;mode=configured|normalized|snapshot</c>
    /// — starts a run in the background and returns immediately.
    /// </summary>
    private static IResult StartRefresh(
        string? region,
        string? mode,
        HttpContext context,
        IOptionsMonitor<CatalogOptions> options,
        ICatalogRefresher refresher)
    {
        if (!IsAuthorized(context, options.CurrentValue))
        {
            return Unauthorized();
        }

        if (!CatalogRegion.IsWellFormed(region))
        {
            return Results.Json(
                new ErrorResponse("invalid-region", ["region must be an ISO 3166-1 alpha-2 code"]),
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (!TryParseMode(mode, out var runMode))
        {
            return Results.Json(
                new ErrorResponse(
                    "invalid-mode",
                    ["mode must be configured, normalized, or snapshot"]),
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (!refresher.TryStart(region!, runMode))
        {
            // At most one run per region, and a request while one is running is
            // refused rather than queued: a second run would rebuild what the
            // first is already building.
            return Results.Json(
                new ErrorResponse(
                    "catalog-refresh-running",
                    [$"a catalog refresh is already running for {region}"]),
                statusCode: StatusCodes.Status409Conflict);
        }

        return Results.Json(
            new { started = true, region = region!.ToUpperInvariant(), mode = runMode.ToString() },
            statusCode: StatusCodes.Status202Accepted);
    }

    /// <summary><c>GET /catalog/refresh/status?region=BR</c> — the latest run, or "none".</summary>
    private static async Task<IResult> GetRefreshStatusAsync(
        string? region,
        HttpContext context,
        IOptionsMonitor<CatalogOptions> options,
        ICatalogRefreshRunStore runs,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized(context, options.CurrentValue))
        {
            return Unauthorized();
        }

        if (!CatalogRegion.IsWellFormed(region))
        {
            return Results.Json(
                new ErrorResponse("invalid-region", ["region must be an ISO 3166-1 alpha-2 code"]),
                statusCode: StatusCodes.Status400BadRequest);
        }

        var latest = await runs.LatestAsync(region!, cancellationToken);

        if (latest is null)
        {
            return Results.Ok(new { region = region!.ToUpperInvariant(), status = "none" });
        }

        return Results.Ok(new CatalogRunStatusResponse(
            latest.Region,
            latest.Kind.ToString(),
            latest.Mode?.ToString(),
            latest.Status.ToString(),
            latest.StartedAt,
            latest.CompletedAt,
            latest.CompletedAt is { } completed
                ? (completed - latest.StartedAt).TotalSeconds
                : null,
            latest.VersionId,
            latest.Counts,
            latest.Failures));
    }

    /// <summary>
    /// Fixed-time comparison of the admin header, so a wrong token cannot be
    /// discovered one character at a time (contracts/catalog-refresh.md).
    ///
    /// The token itself is never logged, echoed, or placed in a URL; it is read
    /// from configuration on each request so a rotation takes effect without the
    /// route table changing.
    /// </summary>
    private static bool IsAuthorized(HttpContext context, CatalogOptions options)
    {
        var expected = options.AdminToken;

        if (string.IsNullOrWhiteSpace(expected)
            || context.Request.Headers[AdminTokenHeader] is not { Count: > 0 } values)
        {
            return false;
        }

        var provided = values.ToString();

        if (provided.Length == 0)
        {
            return false;
        }

        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);

        return providedBytes.Length == expectedBytes.Length
            && CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }

    private static IResult Unauthorized() =>
        Results.Json(
            new ErrorResponse("admin-unauthorized", ["admin token is not valid"]),
            statusCode: StatusCodes.Status401Unauthorized);

    private static bool TryParseMode(string? mode, out CatalogRunMode runMode)
    {
        if (string.IsNullOrWhiteSpace(mode))
        {
            runMode = CatalogRunMode.Configured;

            return true;
        }

        switch (mode.Trim().ToLowerInvariant())
        {
            case "configured":
                runMode = CatalogRunMode.Configured;
                return true;
            case "normalized":
                runMode = CatalogRunMode.Normalized;
                return true;
            case "snapshot":
                runMode = CatalogRunMode.Snapshot;
                return true;
            default:
                runMode = CatalogRunMode.Configured;
                return false;
        }
    }

    /// <summary>
    /// Projects the stored snapshot onto the wire shape.
    ///
    /// The media type goes through the vocabulary rather than the enum's own
    /// name, for the same reason <c>InteractionStates</c> does: <c>"movie"</c>
    /// and <c>"anime"</c> are a storage contract the client has held since 002,
    /// and an enum that were ever reordered must not be able to change them.
    /// </summary>
    private static CatalogResponse ToResponse(CatalogSnapshot snapshot) =>
        new(
            snapshot.Region,
            snapshot.FetchedAt,
            [
                .. snapshot.Titles.Select(title => new TitleDto(
                    title.Id,
                    title.Title,
                    title.ReleaseYear,
                    CatalogMediaTypes.ToWire(title.MediaType),
                    title.Genres,
                    title.Synopsis,
                    title.Rating,
                    title.VoteCount,
                    title.RuntimeMinutes,
                    title.TrailerUrl,
                    title.PosterUrl,
                    [
                        .. title.Availability.Select(badge =>
                            new AvailabilityDto(badge.ProviderId, badge.DeepLinkUrl)),
                    ])),
            ]);
}

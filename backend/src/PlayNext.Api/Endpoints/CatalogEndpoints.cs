using PlayNext.Api.Contracts;
using PlayNext.Application.Contracts;
using PlayNext.Application.UseCases;
using PlayNext.Domain;

namespace PlayNext.Api.Endpoints;

/// <summary>
/// The catalog surface (contracts/catalog.md) — one endpoint, and it is
/// deliberately the only one. The pool arrives at full depth, so opening a
/// title is a lookup in what the client already holds rather than a second
/// request (FR-020).
///
/// <b>Anonymous</b>, and that is a requirement rather than an oversight: a
/// visitor who has just answered the quiz must see titles without being asked
/// who they are (constitution III). Nothing here reads visitor data, so there
/// is nothing for a session to protect.
///
/// Like the other endpoint files, this one translates and decides nothing. The
/// policy — when to serve, when to retrieve — is <see cref="CatalogUseCases"/>'.
/// </summary>
public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/catalog", GetAsync);

        return routes;
    }

    /// <summary>
    /// <c>GET /catalog?region=BR</c> — the visitor's region pool, or an honest
    /// answer about why it is not there yet.
    /// </summary>
    private static async Task<IResult> GetAsync(
        string? region,
        CatalogUseCases useCases,
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

        var result = await useCases.GetAsync(region!, cancellationToken);

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

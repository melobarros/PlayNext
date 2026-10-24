using System.Globalization;
using PlayNext.Api.Contracts;
using PlayNext.Application.Contracts;
using PlayNext.Application.UseCases;
using PlayNext.Application.Validation;

namespace PlayNext.Api.Endpoints;

/// <summary>
/// The recommendation-event intake (contracts/recommendation-events.md).
///
/// One endpoint, deliberately anonymous. A guest's deck is the population this
/// feature exists to observe — requiring an account would mean the record
/// described only the visitors who signed in, which is the smaller and less
/// interesting half. <see cref="CurrentUser.Id"/> is read when a bearer is
/// present so a signed-in visitor's events are attributable, and a stale token
/// is simply ignored: refusing it would stop a signed-out tab from recording
/// its own deck, and the client has no way to tell anyone that happened.
///
/// Like the other endpoint files, this translates and decides nothing. The
/// order (validate, limit, store) is the use case's, and the status codes here
/// are just its three outcomes made visible.
/// </summary>
public static class RecommendationEndpoints
{
    /// <summary>
    /// The largest body the protocol accepts. The per-request counts bound a
    /// well-formed batch far below this; the byte ceiling exists for the batch
    /// that is not well-formed, and is checked before the body is parsed into
    /// anything.
    /// </summary>
    private const int MaxBodyBytes = 256 * 1024;

    public static IEndpointRouteBuilder MapRecommendationEndpoints(this IEndpointRouteBuilder routes)
    {
        // No RequireAuthorization, and no CSRF requirement either: the endpoint
        // changes nothing a visitor can see, and the only credential it would
        // accept is a bearer the browser never attaches on its own.
        routes.MapPost("/api/recommendations/events", RecordAsync);

        return routes;
    }

    private static async Task<IResult> RecordAsync(
        RecommendationEventBatch? body,
        HttpContext http,
        RecordRecommendationEventsUseCase useCase,
        CancellationToken cancellationToken)
    {
        // Size first. A quarter-megabyte body is going to fail validation as
        // well; answering 400 would tell the client to inspect its fields when
        // the only thing wrong is the size, and would make the server parse the
        // body to find out. `ContentLength` is null for a chunked request, and
        // the count limits below still bound what such a body can carry.
        if (http.Request.ContentLength is > MaxBodyBytes)
        {
            return TooLarge();
        }

        if (body is not null
            && ((body.Impressions?.Count ?? 0) > RecommendationEventValidator.MaxImpressions
                || (body.Actions?.Count ?? 0) > RecommendationEventValidator.MaxActions))
        {
            return TooLarge();
        }

        var result = await useCase.ExecuteAsync(body, CurrentUser.Id(http), cancellationToken);

        switch (result.Status)
        {
            case RecommendationIntakeStatus.Invalid:
                return Results.Json(
                    new ErrorResponse("invalid-payload", result.Errors),
                    statusCode: StatusCodes.Status400BadRequest);

            case RecommendationIntakeStatus.RateLimited:
                // The header and the body carry the same number: a proxy or a
                // fetch implementation that only reads headers must not be left
                // guessing, and the body is what a developer debugging the
                // client will actually look at.
                http.Response.Headers.RetryAfter =
                    result.RetryAfterSeconds.ToString(CultureInfo.InvariantCulture);

                return Results.Json(
                    new ErrorResponse("rate-limited", [], result.RetryAfterSeconds),
                    statusCode: StatusCodes.Status429TooManyRequests);

            default:
                // 202, not 200: the events are recorded and there is nothing to
                // return beyond the counts. The client never shows any of this
                // to the visitor — the counters exist for the tests and for
                // someone reading the record back.
                return Results.Json(
                    new RecommendationEventResponse(
                        new RecommendationEventAccepted(
                            result.Outcome.AcceptedImpressions,
                            result.Outcome.AcceptedActions),
                        result.Outcome.Duplicates,
                        result.Outcome.Unlinked),
                    statusCode: StatusCodes.Status202Accepted);
        }
    }

    private static IResult TooLarge() =>
        Results.Json(
            new ErrorResponse("payload-too-large", []),
            statusCode: StatusCodes.Status413PayloadTooLarge);
}

/// <summary>The 202 body: what this flush actually stored.</summary>
public sealed record RecommendationEventResponse(
    RecommendationEventAccepted Accepted,
    int Duplicates,
    int Unlinked);

/// <summary>The per-kind insert counts (contracts/recommendation-events.md).</summary>
public sealed record RecommendationEventAccepted(int Impressions, int Actions);

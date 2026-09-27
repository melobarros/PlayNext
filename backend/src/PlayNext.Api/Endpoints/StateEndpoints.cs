using System.Security.Claims;
using PlayNext.Api.Contracts;
using PlayNext.Application.Contracts;
using PlayNext.Application.UseCases;

namespace PlayNext.Api.Endpoints;

/// <summary>
/// The account state surface (contracts/api.md): read the account, and apply a
/// partial body to it.
///
/// Two endpoints for three callers. A live signed-in change, an offline replay
/// and a guest migration all arrive at <c>POST /me/sync</c>, differing only in
/// how much of the document they carry — a migration sends everything, a live
/// change sends one title. That is why the body is read as *items to apply*
/// rather than as a document: the smaller caller would otherwise be describing
/// an account holding one rating.
///
/// Like <see cref="AuthEndpoints"/>, this file translates and decides nothing.
/// The merge is <see cref="StateUseCases"/>' and, beneath it, the domain's.
/// </summary>
public static class StateEndpoints
{
    public static IEndpointRouteBuilder MapStateEndpoints(this IEndpointRouteBuilder routes)
    {
        // Bearer-authenticated throughout, and that is also the CSRF story:
        // a token attached by script is not sent automatically by the browser,
        // so these carry no X-Requested-With requirement (contracts/api.md).
        var group = routes.MapGroup("/api/me").RequireAuthorization();

        group.MapGet("/state", GetStateAsync);
        group.MapPost("/sync", SyncAsync);

        return routes;
    }

    /// <summary>
    /// <c>GET /me/state</c> — the canonical account, for a device whose cache is
    /// behind (boot restore, research D12).
    /// </summary>
    private static async Task<IResult> GetStateAsync(
        HttpContext http,
        StateUseCases useCases,
        CancellationToken cancellationToken)
    {
        return CurrentUserId(http) is not { } userId
            ? Results.Unauthorized()
            : Results.Ok(AccountStateView.From(await useCases.GetAsync(userId, cancellationToken)));
    }

    /// <summary>
    /// <c>POST /me/sync</c> — the only write endpoint for account data.
    ///
    /// The body may be empty, and that is a normal call rather than a mistake:
    /// "no collections" is a pull, and the answer is the state as it stands.
    /// </summary>
    private static async Task<IResult> SyncAsync(
        GuestStatePayload? body,
        HttpContext http,
        StateUseCases useCases,
        CancellationToken cancellationToken)
    {
        if (CurrentUserId(http) is not { } userId)
        {
            return Results.Unauthorized();
        }

        var result = await useCases.SyncAsync(userId, body, cancellationToken);

        if (result.Succeeded && result.State is { } state)
        {
            return Results.Ok(AccountStateView.From(state));
        }

        // 400 rather than a retryable status: the client must not replay a body
        // the server has refused, or a malformed queue entry becomes a loop
        // (contracts/api.md failure semantics).
        return Results.Json(
            new ErrorResponse("invalid-payload", result.Errors),
            statusCode: StatusCodes.Status400BadRequest);
    }

    /// <summary>
    /// The authenticated account's id, from the bearer token's subject.
    ///
    /// A missing or unparseable subject yields <c>null</c> rather than throwing.
    /// <c>RequireAuthorization</c> has already refused a request without a valid
    /// token, so this is unreachable in practice — but a malformed claim is not
    /// the place to discover that the middleware and this method disagree about
    /// what "authenticated" means, and answering 401 is the same refusal the
    /// middleware would have given.
    /// </summary>
    private static Guid? CurrentUserId(HttpContext http)
    {
        var subject = http.User.FindFirstValue(ClaimTypes.NameIdentifier);

        return Guid.TryParse(subject, out var userId) ? userId : null;
    }
}

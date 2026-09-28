using PlayNext.Api.Contracts;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Infrastructure.Security;

namespace PlayNext.Api.Endpoints;

/// <summary>
/// The auth surface (contracts/api.md): three ways in, one way to stay in, one
/// way out.
///
/// Every endpoint here is a translation and nothing more — status code, cookie,
/// wire shape. The decisions are in <see cref="AuthUseCases"/>, and the reason
/// this file holds none of them is that a rule implemented at the edge is a rule
/// the next endpoint does not get.
/// </summary>
public static class AuthEndpoints
{
    /// <summary>
    /// The CSRF guard for the two cookie-authenticated endpoints (contracts/api.md).
    ///
    /// A custom header is a CSRF defence because a cross-site form post cannot
    /// set one: to send it, the caller has to be script on an origin the CORS
    /// policy already allows. SameSite backs it up rather than replacing it —
    /// the production cookie has to be <c>None</c> for a cross-origin frontend,
    /// so SameSite alone would not be enough there.
    /// </summary>
    private const string CsrfHeader = "X-Requested-With";

    private const string CsrfHeaderValue = "playnext";

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/auth");

        group.MapPost("/register", RegisterAsync);
        group.MapPost("/login", LoginAsync);
        group.MapPost("/google", GoogleAsync);
        group.MapPost("/refresh", RefreshAsync);
        group.MapPost("/logout", LogoutAsync);

        // The one endpoint in this group that requires a session. The other four
        // are how a visitor gets one, so requiring it would be a closed door;
        // this one changes an account, and there has to be an account to change
        // (FR-014). Bearer-authenticated, so like `/me/*` it carries no
        // X-Requested-With requirement: a token attached by script is not sent
        // automatically by a browser, which is the whole of the CSRF story.
        group.MapPost("/change-password", ChangePasswordAsync).RequireAuthorization();

        return routes;
    }

    /// <summary>
    /// <c>POST /auth/change-password</c> — FR-014.
    ///
    /// The account comes from the token and never from the body, which is the
    /// only thing this method has to get right: everything else is a translation
    /// of the use case's outcome.
    /// </summary>
    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        HttpContext http,
        AuthUseCases useCases,
        CancellationToken cancellationToken)
    {
        if (CurrentUser.Id(http) is not { } userId)
        {
            return Results.Unauthorized();
        }

        var result = await useCases.ChangePasswordAsync(userId, request, cancellationToken);

        return result.Status switch
        {
            // No body. There is nothing to hand back — the refresh cookie the
            // visitor already holds is dead by the time this returns, so
            // returning a session would contradict the revocation that is half
            // the point of the endpoint.
            ChangePasswordStatus.Succeeded => Results.NoContent(),

            // FR-010: the new password did not satisfy the policy. 400 with
            // Identity's own reasons, which are written for a person to read.
            ChangePasswordStatus.PasswordRejected => Results.Json(
                new ErrorResponse("invalid-payload", result.Errors),
                statusCode: StatusCodes.Status400BadRequest),

            // FR-011: the same generic 401 as every other credential failure.
            _ => Results.Json(
                new ErrorResponse("invalid-credentials", result.Errors),
                statusCode: StatusCodes.Status401Unauthorized),
        };
    }

    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        HttpContext http,
        AuthUseCases useCases,
        RefreshCookiePolicy cookies,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        // The device's region, per data-model.md. Falling back to configuration
        // rather than rejecting: the field is an addition to a contract that did
        // not carry it, and a client written against that contract must keep
        // working.
        var region = request.Region?.Trim();

        if (string.IsNullOrEmpty(region))
        {
            region = configuration["Region:Default"] ?? "BR";
        }

        return Respond(await useCases.RegisterAsync(request, region, cancellationToken), http, cookies);
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext http,
        AuthUseCases useCases,
        RefreshCookiePolicy cookies,
        CancellationToken cancellationToken)
    {
        // Sign-in does not move an account's region, so there is nothing to
        // resolve here; the use case takes it only because all three entry
        // points share a signature.
        return Respond(await useCases.SignInAsync(request, string.Empty, cancellationToken), http, cookies);
    }

    private static async Task<IResult> GoogleAsync(
        GoogleRequest request,
        HttpContext http,
        AuthUseCases useCases,
        RefreshCookiePolicy cookies,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        return Respond(
            await useCases.GoogleSignInAsync(
                request,
                configuration["Region:Default"] ?? "BR",
                cancellationToken),
            http,
            cookies);
    }

    /// <summary>
    /// Rotates the refresh token and hands back a new access token (FR-015).
    ///
    /// Rotation rather than reuse: the presented token is revoked as it is
    /// spent, so a copy of it that leaked earlier is worth nothing after the
    /// real client refreshes. The new expiry is a fresh 30 days, which is what
    /// makes FR-015 an inactivity timeout rather than a fixed lifetime.
    /// </summary>
    private static async Task<IResult> RefreshAsync(
        HttpContext http,
        ISessionStore sessions,
        ITokenService tokens,
        IAccountStore accounts,
        RefreshCookiePolicy cookies,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (!HasCsrfHeader(http))
        {
            return MissingCsrfHeader();
        }

        if (!TryReadRefreshToken(http, cookies, out var presented))
        {
            return Results.Unauthorized();
        }

        var now = clock.GetUtcNow();
        var session = await sessions.FindLiveAsync(tokens.HashRefreshToken(presented), now, cancellationToken);

        if (session is null || await accounts.FindByIdAsync(session.UserId, cancellationToken) is not { } account)
        {
            // Expired, revoked, or belonging to an account that no longer
            // exists. All three mean the same thing to the client — sign in
            // again — and the cookie is cleared so it stops being sent.
            ClearCookie(http, cookies);

            return Results.Unauthorized();
        }

        var expiresAt = now + AuthUseCases.RefreshLifetime;
        var refresh = tokens.CreateRefreshToken();

        await sessions.RevokeAsync(session.Id, now, cancellationToken);
        await sessions.StoreAsync(session.UserId, refresh.Hash, expiresAt, cancellationToken);

        http.Response.Cookies.Append(RefreshCookiePolicy.Name, refresh.Value, cookies.Create(expiresAt));

        return Results.Ok(new RefreshResponse(tokens.CreateAccessToken(account.Id, account.Email)));
    }

    /// <summary>
    /// Ends the session and clears the cookie (SC-007).
    ///
    /// Idempotent, and returns <c>204</c> even when there was no live session to
    /// revoke: the client's intent is "I am signed out", and failing that
    /// because it was already true would leave the app unable to reach the state
    /// it is asking for.
    /// </summary>
    private static async Task<IResult> LogoutAsync(
        HttpContext http,
        ISessionStore sessions,
        ITokenService tokens,
        RefreshCookiePolicy cookies,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (!HasCsrfHeader(http))
        {
            return MissingCsrfHeader();
        }

        if (TryReadRefreshToken(http, cookies, out var presented))
        {
            var now = clock.GetUtcNow();
            var session = await sessions.FindLiveAsync(tokens.HashRefreshToken(presented), now, cancellationToken);

            if (session is not null)
            {
                await sessions.RevokeAsync(session.Id, now, cancellationToken);
            }
        }

        ClearCookie(http, cookies);

        return Results.NoContent();
    }

    /// <summary>
    /// Turns a use-case outcome into a response — the one place the mapping
    /// lives, so register, sign in and Google cannot drift apart in how they
    /// report the same failure.
    /// </summary>
    private static IResult Respond(AuthResult result, HttpContext http, RefreshCookiePolicy cookies)
    {
        if (result.Succeeded && result.Session is { } session)
        {
            // Written here and nowhere else. The envelope carries the refresh
            // token because it has to reach this line; from here it goes into an
            // httpOnly cookie and is dropped.
            http.Response.Cookies.Append(
                RefreshCookiePolicy.Name,
                session.RefreshToken,
                cookies.Create(session.RefreshExpiresAt));

            return Results.Ok(new SessionResponse(
                session.UserId.ToString(),
                session.Email,
                session.AccessToken,
                AccountStateView.From(session.State)));
        }

        return result.Status switch
        {
            // FR-008. 409 rather than 400: the request was well formed, the
            // address is simply taken, and the message offers the way forward.
            AuthStatus.EmailTaken => Results.Json(
                new ErrorResponse("email-taken", result.Errors),
                statusCode: StatusCodes.Status409Conflict),

            // FR-011. The account is locked and the visitor is told how long to
            // wait, which is the one credential failure that is actionable.
            AuthStatus.LockedOut => Results.Json(
                new ErrorResponse(
                    "locked",
                    result.Errors,
                    (int?)result.RetryAfter?.TotalSeconds ?? 0),
                statusCode: StatusCodes.Status401Unauthorized),

            AuthStatus.InvalidPayload => Results.Json(
                new ErrorResponse("invalid-payload", result.Errors),
                statusCode: StatusCodes.Status400BadRequest),

            // FR-011: wrong password, unknown address and a forged Google token
            // all land here with the same body, because the difference between
            // them is what an attacker would use to enumerate accounts.
            _ => Results.Json(
                new ErrorResponse("invalid-credentials", result.Errors),
                statusCode: StatusCodes.Status401Unauthorized),
        };
    }

    private static bool HasCsrfHeader(HttpContext http)
    {
        return http.Request.Headers.TryGetValue(CsrfHeader, out var values)
            && values.Any(value => string.Equals(value, CsrfHeaderValue, StringComparison.Ordinal));
    }

    /// <summary>
    /// A bad request rather than a 403: the header is part of the request's
    /// shape, and the client that forgot it is our own frontend, not an
    /// attacker who would ignore either status.
    /// </summary>
    private static IResult MissingCsrfHeader()
    {
        return Results.Json(
            new ErrorResponse(
                "missing-client-header",
                [$"This endpoint requires the {CsrfHeader}: {CsrfHeaderValue} header."]),
            statusCode: StatusCodes.Status400BadRequest);
    }

    private static bool TryReadRefreshToken(HttpContext http, RefreshCookiePolicy cookies, out string token)
    {
        if (http.Request.Cookies.TryGetValue(RefreshCookiePolicy.Name, out var value)
            && !string.IsNullOrWhiteSpace(value))
        {
            token = value;

            return true;
        }

        token = string.Empty;

        return false;
    }

    /// <summary>
    /// Deletes the cookie using the same attributes it was written with — a
    /// mismatch makes it a different cookie, and sign-out would appear to
    /// succeed while the real one survived (SC-007).
    /// </summary>
    private static void ClearCookie(HttpContext http, RefreshCookiePolicy cookies)
    {
        http.Response.Cookies.Delete(RefreshCookiePolicy.Name, cookies.CreateForDeletion());
    }
}

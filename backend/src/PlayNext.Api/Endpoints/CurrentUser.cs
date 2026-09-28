using System.Security.Claims;

namespace PlayNext.Api.Endpoints;

/// <summary>
/// Who the request is from, for the endpoints that act on an account.
///
/// One copy, because more than one endpoint needs it and a second copy is a
/// second answer to "which account is this request about" — the question whose
/// wrong answer is a change made to somebody else's data. The account comes
/// from the bearer token's subject and from nowhere else; nothing a caller puts
/// in a body or a query string is consulted, and this is the only method that
/// reads the claim.
/// </summary>
internal static class CurrentUser
{
    /// <summary>
    /// The authenticated account's id, or <c>null</c>.
    ///
    /// A missing or unparseable subject yields <c>null</c> rather than throwing.
    /// <c>RequireAuthorization</c> has already refused a request without a valid
    /// token, so this is unreachable in practice — but a malformed claim is not
    /// the place to discover that the middleware and this method disagree about
    /// what "authenticated" means, and answering 401 is the same refusal the
    /// middleware would have given.
    /// </summary>
    public static Guid? Id(HttpContext http)
    {
        var subject = http.User.FindFirstValue(ClaimTypes.NameIdentifier);

        return Guid.TryParse(subject, out var userId) ? userId : null;
    }
}

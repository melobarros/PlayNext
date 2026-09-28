using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace PlayNext.Infrastructure.Security;

/// <summary>
/// Where the refresh token lives (research D6).
///
/// The token rides an httpOnly cookie — never a response body, never anything
/// script can read — so an XSS that can reach the ratings data in LocalStorage
/// still cannot reach a credential. It is scoped to the auth path so it is not
/// attached to every unrelated request.
///
/// The SameSite value is the part that differs by environment, and it is not a
/// preference: a browser refuses <c>SameSite=None</c> without <c>Secure</c>, and
/// refuses <c>Secure</c> over plain http. Locally the frontend and API are two
/// ports on localhost (same site, plain http) so Strict works; in Azure they are
/// different origins over https, so it must be None;Secure. CSRF protection in
/// production therefore rests on the required <c>X-Requested-With</c> header,
/// which a cross-origin caller cannot set (contracts/api.md).
/// </summary>
public sealed class RefreshCookiePolicy(IHostEnvironment environment)
{
    /// <summary>The cookie's name. Not "token" — nothing about its purpose is advertised.</summary>
    public const string Name = "playnext.refresh";

    /// <summary>
    /// Scoped to the auth endpoints, so the credential is not sent with state
    /// reads or syncs that authenticate by bearer token anyway.
    /// </summary>
    public const string Path = "/api/auth";

    /// <summary>Cookie settings for writing or clearing the refresh token.</summary>
    public CookieOptions Create(DateTimeOffset? expiresAt = null)
    {
        var isDevelopment = environment.IsDevelopment();

        return new CookieOptions
        {
            HttpOnly = true,
            Secure = !isDevelopment,
            SameSite = isDevelopment ? SameSiteMode.Strict : SameSiteMode.None,
            Path = Path,
            IsEssential = true,

            // A session cookie when no expiry is given: the 30-day window is
            // enforced server-side against the UserSession row, so the client's
            // copy is deliberately not the thing that decides how long it lasts.
            Expires = expiresAt,
        };
    }

    /// <summary>
    /// Settings for removing the cookie on sign-out. The attributes must match
    /// <see cref="Create"/> or the browser treats it as a different cookie and
    /// the old one survives sign-out — which is precisely the failure SC-007
    /// would catch.
    /// </summary>
    public CookieOptions CreateForDeletion()
    {
        var options = Create();
        options.Expires = DateTimeOffset.UnixEpoch;

        return options;
    }
}

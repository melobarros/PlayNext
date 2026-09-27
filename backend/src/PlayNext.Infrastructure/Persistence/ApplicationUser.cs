using Microsoft.AspNetCore.Identity;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// A registered visitor.
///
/// This is ASP.NET Core Identity's own user type, extended with the two columns
/// the spec asks for. Identity brings the password hashing (PBKDF2, its
/// default) and the lockout counters (FR-011) as framework behaviour, so they
/// are inherited rather than reimplemented — research D10 chose the built-in
/// mechanism precisely so the 5-failures-then-15-minutes rule is the
/// framework's well-tested one and not a hand-rolled counter.
///
/// It lives in Infrastructure, not Domain, because it derives from a framework
/// type: the constitution's architecture rule keeps Domain free of framework
/// references, so domain code deals in a bare <see cref="Guid"/> user id and the
/// API maps between the two.
/// </summary>
public class ApplicationUser : IdentityUser<Guid>
{
    /// <summary>When the account was created.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// The device's <c>DEFAULT_REGION</c>, copied at registration.
    ///
    /// A placeholder: Milestone 2 makes regions real (per-region catalogs and
    /// availability). It is captured now so that the accounts created before
    /// then do not have to be back-filled.
    /// </summary>
    public string Region { get; set; } = string.Empty;
}

namespace PlayNext.Application.Interfaces;

/// <summary>
/// Who Google says the visitor is. Only ever produced from a token whose
/// signature, issuer, audience and expiry all checked out.
/// </summary>
/// <param name="Subject">Google's stable id for the account.</param>
/// <param name="Email">The verified address, which is what links to an existing PlayNext account (FR-009).</param>
/// <param name="EmailVerified">
/// Whether Google reports the address as verified. Linking by email is only
/// safe when it is true — otherwise anyone able to create a Google account
/// claiming someone else's address could take over that account.
/// </param>
public sealed record GoogleIdentity(string Subject, string Email, bool EmailVerified);

/// <summary>
/// Validates a Google ID token obtained by the browser (research D5).
///
/// Behind an interface so the auth use cases can be tested without reaching
/// Google, and so the one place that talks to Google's JWKS is small enough to
/// read in full.
/// </summary>
public interface IGoogleTokenVerifier
{
    /// <summary>
    /// Verifies an ID token, returning <c>null</c> for anything that does not
    /// check out. A null return is not distinguished by the caller: an expired
    /// token, a forged one, and one minted for a different application are all
    /// simply "not signed in".
    /// </summary>
    Task<GoogleIdentity?> VerifyAsync(string idToken, CancellationToken cancellationToken);
}

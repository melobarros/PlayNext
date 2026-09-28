using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.Validation;
using PlayNext.Domain;

namespace PlayNext.Application.UseCases;

/// <summary>
/// The three ways into an account — register, sign in, Google — and the one
/// thing all three do afterwards.
///
/// They share <c>CompleteAsync</c> deliberately. Every path ends in the same
/// place: merge whatever the device was carrying into the account, then issue a
/// session over the canonical result. Writing that once is what makes US1 and
/// US3 the same code path rather than two implementations of "migrate the guest
/// data" that could drift apart (contracts/api.md: "the same behavior is not
/// implemented three ways").
///
/// The merge is <see cref="Domain.MergeService"/>'s, reached through
/// <see cref="IAccountStateRepository"/> — this class decides *when* a merge
/// happens, never *how*.
/// </summary>
public sealed class AuthUseCases(
    IAccountStore accounts,
    IAccountStateRepository states,
    ISessionStore sessions,
    ITokenService tokens,
    IGoogleTokenVerifier google,
    TimeProvider clock)
{
    /// <summary>
    /// The window a refresh token is good for without activity (FR-015). It
    /// slides forward on each refresh, so this is an inactivity timeout rather
    /// than a fixed lifetime.
    /// </summary>
    public static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(30);

    /// <summary>
    /// One message for every way a credential can fail (FR-011).
    ///
    /// The same string for a wrong password, an unknown address, a forged Google
    /// token and an unverified Google email — because the differences between
    /// those are exactly what an attacker would use to enumerate accounts, and
    /// none of them is actionable to the person actually holding the account.
    /// A lockout is the one exception: that visitor *can* act on it, so it gets
    /// its own answer.
    /// </summary>
    private const string GenericCredentialFailure = "Those details did not match an account.";

    /// <summary>Creates an account, migrating whatever the device was carrying (US1).</summary>
    public async Task<AuthResult> RegisterAsync(
        RegisterRequest request,
        string region,
        CancellationToken cancellationToken)
    {
        var email = Normalize(request.Email);

        if (CredentialValidator.ValidateEmail(email) is { Count: > 0 } emailErrors)
        {
            return AuthResult.Failure(AuthStatus.InvalidPayload, [.. emailErrors]);
        }

        // Checked before the account exists, not after: a document the API
        // cannot read in full must not leave a half-migrated account behind.
        var guest = GuestStateValidator.Validate(request.Guest);

        if (!guest.IsValid)
        {
            return AuthResult.Failure(AuthStatus.InvalidPayload, [.. guest.Errors]);
        }

        var creation = await accounts.CreateAsync(
            email,
            request.Password ?? string.Empty,
            region,
            cancellationToken);

        return creation.Status switch
        {
            // FR-008: the visitor is offered the way forward, not just told no.
            AccountCreationStatus.EmailTaken => AuthResult.Failure(
                AuthStatus.EmailTaken,
                "That email already has an account. Sign in instead."),

            // Identity refused the password. Its reasons are already written for
            // a person to read, so they are passed through rather than replaced
            // with something vaguer.
            AccountCreationStatus.Rejected => AuthResult.Failure(AuthStatus.InvalidPayload, [.. creation.Errors]),

            _ => AuthResult.Success(
                await CompleteAsync(creation.Account!, guest.Value!, cancellationToken)),
        };
    }

    /// <summary>
    /// Signs in to an existing account, merging the device's guest data under
    /// the same rule as registration (US3).
    /// </summary>
    /// <remarks>
    /// <paramref name="region"/> is unused here and is not an oversight: an
    /// account's region is set when it is created, and signing in from elsewhere
    /// is not a change of address. It stays in the signature because the endpoint
    /// layer resolves it once for all three entry points.
    /// </remarks>
    public async Task<AuthResult> SignInAsync(
        LoginRequest request,
        string region,
        CancellationToken cancellationToken)
    {
        var email = Normalize(request.Email);

        if (CredentialValidator.ValidateEmail(email) is { Count: > 0 } emailErrors)
        {
            return AuthResult.Failure(AuthStatus.InvalidPayload, [.. emailErrors]);
        }

        var guest = GuestStateValidator.Validate(request.Guest);

        if (!guest.IsValid)
        {
            return AuthResult.Failure(AuthStatus.InvalidPayload, [.. guest.Errors]);
        }

        var check = await accounts.CheckPasswordAsync(
            email,
            request.Password ?? string.Empty,
            cancellationToken);

        if (check.Status == CredentialCheck.LockedOut)
        {
            return new AuthResult(
                AuthStatus.LockedOut,
                null,
                ["Too many attempts. Try again shortly."],
                check.LockoutRemaining);
        }

        if (check.Status != CredentialCheck.Succeeded || check.Account is null)
        {
            return AuthResult.Failure(AuthStatus.InvalidCredentials, GenericCredentialFailure);
        }

        return AuthResult.Success(
            await CompleteAsync(check.Account, guest.Value!, cancellationToken));
    }

    /// <summary>Signs in with a Google ID token, linking by verified email (FR-009).</summary>
    public async Task<AuthResult> GoogleSignInAsync(
        GoogleRequest request,
        string region,
        CancellationToken cancellationToken)
    {
        var guest = GuestStateValidator.Validate(request.Guest);

        if (!guest.IsValid)
        {
            return AuthResult.Failure(AuthStatus.InvalidPayload, [.. guest.Errors]);
        }

        if (string.IsNullOrWhiteSpace(request.Credential))
        {
            return AuthResult.Failure(AuthStatus.InvalidCredentials, GenericCredentialFailure);
        }

        // The verifier has already checked the signature, issuer, audience and
        // expiry; what is left is the one claim it reports but does not rule on.
        var identity = await google.VerifyAsync(request.Credential, cancellationToken);

        // An unverified address must not link to an account that already has it.
        // Without this, anyone able to create a Google account claiming someone
        // else's address would be signed into that person's PlayNext account —
        // and the check is here, before any lookup, so there is no code path
        // that links first and asks later (FR-009).
        if (identity is null || !identity.EmailVerified)
        {
            return AuthResult.Failure(AuthStatus.InvalidCredentials, GenericCredentialFailure);
        }

        // Existing address → that account, so a Google sign-in on a registered
        // email is a sign-in and never a duplicate (FR-009).
        var account = await accounts.FindOrCreateExternalAsync(identity.Email, region, cancellationToken);

        return AuthResult.Success(
            await CompleteAsync(account, guest.Value!, cancellationToken));
    }

    /// <summary>
    /// Replaces the account's password, then ends every session it had (FR-014).
    /// </summary>
    /// <remarks>
    /// <paramref name="userId"/> is a parameter of its own rather than a field on
    /// <see cref="ChangePasswordRequest"/>, and that is the security-relevant
    /// part of the signature. The account being changed comes from the bearer
    /// token's <c>sub</c> claim; a request body naming its own account would let
    /// any signed-in visitor change anyone's password.
    ///
    /// The revocation is not a side effect of the change, it is half of it. A
    /// password is changed because it may be known to someone else, so the
    /// sessions that were opened with it have to end — all of them, including
    /// the one that asked, because "the one that asked" is exactly what a thief
    /// holding a stolen session would be. The visitor's cost is that they sign
    /// in again on this device too; the alternative is leaving an intruder
    /// signed in, which is the failure the feature exists to prevent.
    ///
    /// Order matters at the edges. Nothing is revoked until the change has
    /// succeeded — a mistyped current password must not sign a visitor out of
    /// every device they own — and the change is committed before the
    /// revocation, so a failure in the second step leaves the credential
    /// rotated rather than the sessions alive.
    /// </remarks>
    public async Task<ChangePasswordResult> ChangePasswordAsync(
        Guid userId,
        ChangePasswordRequest request,
        CancellationToken cancellationToken)
    {
        bool changed;

        try
        {
            // The policy is Identity's, applied inside the store; nothing is
            // restated here to drift from it. A missing field is an empty
            // string rather than a null, because Identity throws on null
            // arguments and a malformed body deserves an ordinary refusal
            // instead of a 500.
            changed = await accounts.ChangePasswordAsync(
                userId,
                request.CurrentPassword ?? string.Empty,
                request.NewPassword ?? string.Empty,
                cancellationToken);
        }
        catch (WeakPasswordException rejected)
        {
            // Identity's own wording, passed through for the same reason the
            // sign-in messages are: it is already written for a person to read,
            // and a second copy of the policy is the copy that goes stale.
            return ChangePasswordResult.Failure(ChangePasswordStatus.PasswordRejected, [.. rejected.Errors]);
        }

        if (!changed)
        {
            // The same sentence as a failed sign-in, deliberately. This endpoint
            // is reachable only by someone already holding a session, which is
            // precisely the position from which a specific answer would be worth
            // probing for.
            return ChangePasswordResult.Failure(
                ChangePasswordStatus.InvalidCredentials,
                GenericCredentialFailure);
        }

        await sessions.RevokeAllForUserAsync(userId, clock.GetUtcNow(), cancellationToken);

        return ChangePasswordResult.Success();
    }

    /// <summary>
    /// What every way in does once the visitor is known: merge, then issue.
    ///
    /// The merge comes first because the session has to describe the account as
    /// it now is — the client replaces its device state with what this returns
    /// (SC-001), so issuing a session over a state that predates the merge would
    /// hand the device back exactly the data it just tried to migrate away from.
    /// </summary>
    private async Task<SessionEnvelope> CompleteAsync(
        AccountRecord account,
        AccountState guest,
        CancellationToken cancellationToken)
    {
        var state = await states.MergeIntoAccountAsync(account.Id, guest, cancellationToken);

        var expiresAt = clock.GetUtcNow() + RefreshLifetime;
        var refresh = tokens.CreateRefreshToken();

        // Only the hash is kept. The raw token exists in this method and then in
        // the cookie the API sets, and nowhere else (research D6).
        await sessions.StoreAsync(account.Id, refresh.Hash, expiresAt, cancellationToken);

        return new SessionEnvelope(
            account.Id,
            account.Email,
            tokens.CreateAccessToken(account.Id, account.Email),
            refresh.Value,
            expiresAt,
            state);
    }

    /// <summary>
    /// Trims once, at the boundary, so the address validated and the address
    /// stored are the same string — and so a trailing space from a phone
    /// keyboard does not create a second account.
    /// </summary>
    private static string Normalize(string? email) => email?.Trim() ?? string.Empty;
}

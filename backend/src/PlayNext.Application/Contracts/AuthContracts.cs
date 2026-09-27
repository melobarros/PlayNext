using PlayNext.Domain;

namespace PlayNext.Application.Contracts;

/// <summary>
/// The body of <c>POST /auth/register</c> (contracts/api.md). <c>Guest</c> is
/// optional: a visitor who never used the app before registering simply has
/// nothing to migrate (US1 scenario 4).
/// </summary>
/// <param name="Region">
/// The device's region, which data-model.md records the account as copying at
/// registration ("copied from the device's DEFAULT_REGION"). Optional, because
/// contracts/api.md does not list it and a client that omits it is still a
/// valid registration — the server falls back to its configured default. It is
/// a placeholder until Milestone 2 makes regions real, which is why it is a
/// plain string here rather than a type.
/// </param>
public sealed record RegisterRequest(
    string? Email,
    string? Password,
    GuestStatePayload? Guest,
    string? Region = null);

/// <summary>The body of <c>POST /auth/login</c>, carrying the device's guest data for the merge (US3).</summary>
public sealed record LoginRequest(string? Email, string? Password, GuestStatePayload? Guest);

/// <summary>The body of <c>POST /auth/google</c> — the ID token Google Identity Services returned to the browser.</summary>
public sealed record GoogleRequest(string? Credential, GuestStatePayload? Guest);

/// <summary>The body of <c>POST /auth/change-password</c>.</summary>
public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

/// <summary>Why an auth attempt ended as it did. Maps to the contract's status codes.</summary>
public enum AuthStatus
{
    /// <summary>Signed in.</summary>
    Succeeded,

    /// <summary>Wrong credentials, or a Google token that did not verify. Always generic (FR-011).</summary>
    InvalidCredentials,

    /// <summary>The address is already registered (FR-008). The message offers sign-in.</summary>
    EmailTaken,

    /// <summary>Locked out after too many failures; <c>RetryAfter</c> says for how long (FR-011).</summary>
    LockedOut,

    /// <summary>The request itself was malformed — a bad email, or a rejected guest document.</summary>
    InvalidPayload,
}

/// <summary>
/// What a successful sign-in hands back.
///
/// The refresh token is in this record because it has to reach the response
/// once; the API writes it to an httpOnly cookie and never to the body. It is
/// not stored anywhere else — the server keeps only its hash.
/// </summary>
/// <param name="UserId">
/// Here because the device's session marker records who is signed in
/// (contracts/device-storage.md), and the alternative was worse: the client
/// would have to decode its own access token to recover a value the server
/// already has, and a marker built from a claim inside a 15-minute credential
/// would break silently the day that claim changed.
/// </param>
/// <param name="Email">
/// Here for the same reason as <paramref name="UserId"/>, and it is not
/// redundant with the request: a Google sign-in never sees the address — the
/// visitor picked an account in Google's chooser and the client only ever held
/// an ID token — yet the marker stores an email to display.
/// </param>
public sealed record SessionEnvelope(
    Guid UserId,
    string Email,
    string AccessToken,
    string RefreshToken,
    DateTimeOffset RefreshExpiresAt,
    AccountState State);

/// <summary>
/// The outcome of an auth attempt: a session, or the reasons there is none.
/// </summary>
public sealed record AuthResult(
    AuthStatus Status,
    SessionEnvelope? Session,
    IReadOnlyList<string> Errors,
    TimeSpan? RetryAfter)
{
    /// <summary>A signed-in outcome.</summary>
    public static AuthResult Success(SessionEnvelope session) => new(AuthStatus.Succeeded, session, [], null);

    /// <summary>A failure carrying a message for the visitor.</summary>
    public static AuthResult Failure(AuthStatus status, params string[] errors) => new(status, null, errors, null);

    /// <summary>Whether the visitor is signed in.</summary>
    public bool Succeeded => Status == AuthStatus.Succeeded;
}

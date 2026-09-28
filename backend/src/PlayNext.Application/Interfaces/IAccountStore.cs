namespace PlayNext.Application.Interfaces;

/// <summary>An account, as the use cases know it — no framework type in sight.</summary>
public sealed record AccountRecord(Guid Id, string Email);

/// <summary>Why an account creation did or did not happen.</summary>
public enum AccountCreationStatus
{
    /// <summary>The account exists and the visitor is signed in.</summary>
    Created,

    /// <summary>The address is already registered — FR-008's "sign in instead".</summary>
    EmailTaken,

    /// <summary>Identity refused the password. <c>Errors</c> carries its reasons.</summary>
    Rejected,
}

/// <summary>The outcome of creating an account.</summary>
public sealed record AccountCreation(
    AccountCreationStatus Status,
    AccountRecord? Account,
    IReadOnlyList<string> Errors);

/// <summary>Why a credential check did or did not pass.</summary>
public enum CredentialCheck
{
    /// <summary>The credentials are good.</summary>
    Succeeded,

    /// <summary>Wrong email or wrong password — the caller must not be told which (FR-011).</summary>
    InvalidCredentials,

    /// <summary>Too many consecutive failures; the account is locked (FR-011).</summary>
    LockedOut,
}

/// <summary>The outcome of checking a credential.</summary>
public sealed record CredentialResult(
    CredentialCheck Status,
    AccountRecord? Account,
    TimeSpan? LockoutRemaining);

/// <summary>
/// Identity, behind an interface.
///
/// The Application layer orchestrates registration and sign-in but must not
/// reference <c>UserManager</c>: the user type it manages lives in
/// Infrastructure, and dependencies only point inward (constitution VII). This
/// is that boundary — it speaks in plain records, and Infrastructure answers
/// with Identity's results translated.
///
/// The 5-failures-then-15-minutes counting is deliberately *not* modelled here.
/// It is Identity's lockout (research D10), and the only honest place to verify
/// the counting is against the real thing (T017's integration suite); these
/// methods only carry its verdict, including how long is left.
/// </summary>
public interface IAccountStore
{
    /// <summary>Creates a password account, or reports why it could not.</summary>
    Task<AccountCreation> CreateAsync(
        string email,
        string password,
        string region,
        CancellationToken cancellationToken);

    /// <summary>
    /// Checks a password, applying and reporting Identity's lockout.
    /// </summary>
    Task<CredentialResult> CheckPasswordAsync(
        string email,
        string password,
        CancellationToken cancellationToken);

    /// <summary>The account with this address, or <c>null</c>.</summary>
    Task<AccountRecord?> FindByEmailAsync(string email, CancellationToken cancellationToken);

    /// <summary>The account with this id, or <c>null</c>.</summary>
    Task<AccountRecord?> FindByIdAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// Finds or creates the account for a verified Google identity (FR-009).
    /// Returns the existing account when the address already has one — the
    /// Google sign-in becomes a sign-in, and no duplicate is created.
    /// </summary>
    Task<AccountRecord> FindOrCreateExternalAsync(
        string email,
        string region,
        CancellationToken cancellationToken);

    /// <summary>
    /// Replaces the password, given the current one. A <c>false</c> return means
    /// the current password was wrong — never that the new one was weak, which
    /// is <see cref="CreateAsync"/>'s concern.
    /// </summary>
    Task<bool> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken);
}

/// <summary>
/// Identity refused the new password on policy grounds (FR-010).
///
/// Thrown rather than returned because <see cref="IAccountStore.ChangePasswordAsync"/>
/// is a <c>bool</c> whose <c>false</c> is spoken for, and because this is a
/// different conversation with the visitor: "your current password is wrong" and
/// "choose a stronger one" lead to different screens.
///
/// It lives beside the interface that declares it, and not in Infrastructure
/// where it is thrown. The exception is part of the contract — any
/// implementation of <see cref="IAccountStore"/> owes its callers this signal —
/// and a contract type that only one implementation can see is one the
/// Application layer could not honour without reaching outward past its own
/// boundary (constitution VII).
/// </summary>
public sealed class WeakPasswordException(IReadOnlyList<string> errors)
    : Exception("The new password does not satisfy the password policy.")
{
    /// <summary>Identity's own messages, already written for a person to read.</summary>
    public IReadOnlyList<string> Errors { get; } = errors;
}

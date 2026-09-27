using Microsoft.AspNetCore.Identity;
using PlayNext.Application.Interfaces;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Infrastructure.Security;

/// <summary>
/// <see cref="IAccountStore"/> on ASP.NET Core Identity (research D10).
///
/// This is the only file in the solution that touches <see cref="UserManager{TUser}"/>.
/// Everything above it speaks in <see cref="AccountRecord"/> and verdicts, which
/// is what keeps Identity — and the user type it manages — out of the
/// Application layer entirely (constitution VII).
///
/// The interesting decisions here are all about *not* deciding: password
/// hashing, the password policy, email normalization and the failed-attempt
/// counter are Identity's, and none of them is restated. The counting in
/// particular is deliberately left to <see cref="SignInManager{TUser}"/>, since
/// a hand-rolled counter in front of Identity's would be a second source of
/// truth for the same number.
/// </summary>
public sealed class IdentityAccountStore(
    UserManager<ApplicationUser> users,
    SignInManager<ApplicationUser> signIn,
    TimeProvider clock) : IAccountStore
{
    /// <summary>Identity's own error code for the unique-email violation (FR-008).</summary>
    private static readonly string DuplicateEmailCode = nameof(IdentityErrorDescriber.DuplicateEmail);

    public async Task<AccountCreation> CreateAsync(
        string email,
        string password,
        string region,
        CancellationToken cancellationToken)
    {
        var user = NewUser(email, region);

        var result = await users.CreateAsync(user, password);

        if (result.Succeeded)
        {
            return new AccountCreation(
                AccountCreationStatus.Created,
                new AccountRecord(user.Id, email),
                []);
        }

        // Read Identity's verdict rather than pre-checking for a duplicate: a
        // lookup followed by a create is a race, and the unique index is the
        // only thing that actually decides (FR-008).
        if (result.Errors.Any(error => error.Code == DuplicateEmailCode))
        {
            return new AccountCreation(AccountCreationStatus.EmailTaken, null, []);
        }

        // Everything else is the password failing policy. Identity writes those
        // messages for a person to read, so they are passed through as-is.
        return new AccountCreation(
            AccountCreationStatus.Rejected,
            null,
            [.. result.Errors.Select(error => error.Description)]);
    }

    public async Task<CredentialResult> CheckPasswordAsync(
        string email,
        string password,
        CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(email);

        // An unknown address reports exactly what a wrong password does. Telling
        // the caller which of the two it was is the account-enumeration leak
        // FR-011 exists to prevent.
        if (user is null)
        {
            return new CredentialResult(CredentialCheck.InvalidCredentials, null, null);
        }

        var result = await signIn.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true);

        if (result.Succeeded)
        {
            return new CredentialResult(
                CredentialCheck.Succeeded,
                new AccountRecord(user.Id, user.Email!),
                null);
        }

        // Asked after the attempt rather than before it: the failure that trips
        // the threshold is the one that should say so, and Identity sets the
        // lockout during that call. Reading it only up front would make the
        // visitor wait a whole extra attempt to learn they are locked out.
        if (await users.IsLockedOutAsync(user))
        {
            return new CredentialResult(CredentialCheck.LockedOut, null, await RemainingLockoutAsync(user));
        }

        return new CredentialResult(CredentialCheck.InvalidCredentials, null, null);
    }

    public async Task<AccountRecord?> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(email);

        return user is null ? null : new AccountRecord(user.Id, user.Email ?? email);
    }

    public async Task<AccountRecord?> FindByIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(userId.ToString());

        return user is null ? null : new AccountRecord(user.Id, user.Email ?? string.Empty);
    }

    /// <summary>
    /// Links by email, which is the whole of the linking rule at this scale
    /// (data-model.md: "the email anchor is what links").
    ///
    /// The account is created without a password, so it can only be reached
    /// through Google — which is why the caller must have verified the address
    /// first. Creating an unverified one here would hand out a password-less
    /// account for an address nobody proved they own.
    /// </summary>
    public async Task<AccountRecord> FindOrCreateExternalAsync(
        string email,
        string region,
        CancellationToken cancellationToken)
    {
        var existing = await users.FindByEmailAsync(email);

        if (existing is not null)
        {
            return new AccountRecord(existing.Id, existing.Email ?? email);
        }

        var user = NewUser(email, region);

        var result = await users.CreateAsync(user);

        if (result.Succeeded)
        {
            return new AccountRecord(user.Id, email);
        }

        // Lost a race to a concurrent sign-in for the same address. The row now
        // exists, which is the outcome this method promises, so it is read back
        // rather than reported as a failure.
        var raced = await users.FindByEmailAsync(email);

        if (raced is not null)
        {
            return new AccountRecord(raced.Id, raced.Email ?? email);
        }

        throw new InvalidOperationException(
            $"Could not create or find an account for the Google identity: {string.Join("; ", result.Errors.Select(error => error.Description))}");
    }

    /// <summary>
    /// Replaces the password given the current one (FR-014).
    ///
    /// A <c>false</c> return means the current password did not match; a policy
    /// rejection throws <see cref="WeakPasswordException"/> instead, because the
    /// interface's <c>bool</c> cannot carry both and the visitor needs them
    /// apart ("that password is wrong" and "choose a stronger one" lead to
    /// different screens).
    ///
    /// Identity's own call is used rather than a check-then-set written here.
    /// It verifies the current password and validates the new one *before*
    /// touching the stored hash, so a rejection leaves the old password working
    /// — which a hand-rolled version that cleared the hash first would not.
    /// </summary>
    public async Task<bool> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(userId.ToString());

        if (user is null)
        {
            return false;
        }

        var result = await users.ChangePasswordAsync(user, currentPassword, newPassword);

        if (result.Succeeded)
        {
            return true;
        }

        if (result.Errors.Any(error => error.Code == nameof(IdentityErrorDescriber.PasswordMismatch)))
        {
            return false;
        }

        throw new WeakPasswordException([.. result.Errors.Select(error => error.Description)]);
    }

    private ApplicationUser NewUser(string email, string region)
    {
        return new ApplicationUser
        {
            Id = Guid.NewGuid(),

            // Identity keys uniqueness on the normalized email and requires a
            // user name; the address serves as both, so there is no second
            // identifier for a visitor to remember or for us to invent.
            Email = email,
            UserName = email,

            Region = region,
            CreatedAt = clock.GetUtcNow(),
        };
    }

    private async Task<TimeSpan> RemainingLockoutAsync(ApplicationUser user)
    {
        var endsAt = await users.GetLockoutEndDateAsync(user);

        if (endsAt is not { } end)
        {
            return TimeSpan.Zero;
        }

        var remaining = end - clock.GetUtcNow();

        return remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero;
    }
}

/// <summary>
/// Identity refused the new password on policy grounds (FR-010).
///
/// Thrown rather than returned because <see cref="IAccountStore.ChangePasswordAsync"/>
/// is a <c>bool</c> whose <c>false</c> is spoken for, and because this is a
/// different conversation with the visitor: "your current password is wrong" and
/// "choose a stronger one" lead to different screens.
/// </summary>
public sealed class WeakPasswordException(IReadOnlyList<string> errors)
    : Exception("The new password does not satisfy the password policy.")
{
    /// <summary>Identity's own messages, already written for a person to read.</summary>
    public IReadOnlyList<string> Errors { get; } = errors;
}

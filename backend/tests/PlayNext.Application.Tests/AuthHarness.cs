using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;

namespace PlayNext.Application.Tests;

/// <summary>
/// The auth use cases and their collaborators, wired together with fakes.
///
/// Shared between <see cref="AuthUseCaseTests"/> and
/// <see cref="ChangePasswordTests"/> for the same reason
/// <see cref="InMemoryAccountStateRepository"/> is shared: two copies of a fake
/// are two things that can disagree, and the disagreement surfaces as a suite
/// that passes while the real collaborators do not.
///
/// What these can and cannot prove is worth stating plainly. They pin the
/// *orchestration*: which collaborator is called, in what order, and how each
/// answer is mapped onto an outcome. Anything about Identity's own behaviour —
/// the lockout counting to five, the password policy, the hash — is not
/// modelled here, because a fake that decided those would only be agreeing with
/// itself. Those claims belong to the gated integration suite, against the real
/// stack (T017).
/// </summary>
internal sealed class Harness
{
    public static readonly DateTimeOffset Now = new(2026, 9, 27, 12, 0, 0, TimeSpan.Zero);

    /// <summary>A guest document with one history entry, for the ways in that merge one.</summary>
    public static GuestStatePayload Guest(params (string TitleId, string State)[] interactions)
    {
        return new GuestStatePayload(
            interactions.ToDictionary(
                entry => entry.TitleId,
                entry => new InteractionPayload(entry.State, "2026-09-27T10:00:00Z"),
                StringComparer.Ordinal),
            [new HistoryPayload("arrival", "2026-09-27T10:05:00Z")],
            null);
    }

    public FakeAccountStore Accounts { get; } = new();

    public InMemoryAccountStateRepository States { get; } = new();

    public FakeSessionStore Sessions { get; } = new();

    public FakeTokenService Tokens { get; } = new();

    public FakeGoogleTokenVerifier Google { get; } = new();

    public AuthUseCases UseCases => new(Accounts, States, Sessions, Tokens, Google, new FixedClock(Now));
}

internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

internal sealed class FakeAccountStore : IAccountStore
{
    private readonly Dictionary<string, AccountRecord> _byEmail = new(StringComparer.OrdinalIgnoreCase);

    public AccountCreationStatus Creation { get; set; } = AccountCreationStatus.Created;

    public CredentialCheck Check { get; set; } = CredentialCheck.Succeeded;

    public TimeSpan? LockoutRemaining { get; set; }

    public IReadOnlyList<string> RejectionErrors { get; set; } = ["Password is too weak."];

    /// <summary>Set when the account exists before the call, as on a returning sign-in.</summary>
    public void Seed(string email)
    {
        _byEmail[email] = new AccountRecord(Guid.NewGuid(), email);
    }

    public Task<AccountCreation> CreateAsync(
        string email,
        string password,
        string region,
        CancellationToken cancellationToken)
    {
        if (Creation != AccountCreationStatus.Created)
        {
            return Task.FromResult(new AccountCreation(Creation, null, RejectionErrors));
        }

        var account = new AccountRecord(Guid.NewGuid(), email);
        _byEmail[email] = account;

        return Task.FromResult(new AccountCreation(AccountCreationStatus.Created, account, []));
    }

    public Task<CredentialResult> CheckPasswordAsync(
        string email,
        string password,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(Check switch
        {
            CredentialCheck.Succeeded => new CredentialResult(Check, _byEmail[email], null),
            CredentialCheck.LockedOut => new CredentialResult(Check, null, LockoutRemaining),
            _ => new CredentialResult(CredentialCheck.InvalidCredentials, null, null),
        });
    }

    public Task<AccountRecord?> FindByEmailAsync(string email, CancellationToken cancellationToken)
        => Task.FromResult(_byEmail.GetValueOrDefault(email));

    public Task<AccountRecord?> FindByIdAsync(Guid userId, CancellationToken cancellationToken)
        => Task.FromResult(_byEmail.Values.FirstOrDefault(account => account.Id == userId));

    public Task<AccountRecord> FindOrCreateExternalAsync(
        string email,
        string region,
        CancellationToken cancellationToken)
    {
        if (!_byEmail.TryGetValue(email, out var account))
        {
            account = new AccountRecord(Guid.NewGuid(), email);
            _byEmail[email] = account;
        }

        return Task.FromResult(account);
    }

    /// <summary>
    /// The change-password calls this store was asked to make.
    ///
    /// Recorded rather than merely counted, because the user id is the one value
    /// that must come from the session and never from the request body: a change
    /// addressed by anything the caller supplied is a change to an account the
    /// caller may not own. The signature already keeps the two apart — the use
    /// case takes the id as its own parameter — and this is what shows the id
    /// which actually reached the store is the token's.
    /// </summary>
    public List<(Guid UserId, string CurrentPassword, string NewPassword)> Changes { get; } = [];

    /// <summary>Whether the current password matches. Set <c>false</c> for the wrong-password path.</summary>
    public bool CurrentPasswordMatches { get; set; } = true;

    /// <summary>Set to have the store refuse the new password on policy grounds (FR-010).</summary>
    public IReadOnlyList<string>? WeakNewPassword { get; set; }

    public Task<bool> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken)
    {
        Changes.Add((userId, currentPassword, newPassword));

        if (WeakNewPassword is { } errors)
        {
            throw new WeakPasswordException(errors);
        }

        return Task.FromResult(CurrentPasswordMatches);
    }
}

internal sealed class FakeSessionStore : ISessionStore
{
    public List<(Guid UserId, string Hash, DateTimeOffset ExpiresAt)> Stored { get; } = [];

    public List<Guid> RevokedUsers { get; } = [];

    public Task StoreAsync(Guid userId, string tokenHash, DateTimeOffset expiresAt, CancellationToken cancellationToken)
    {
        Stored.Add((userId, tokenHash, expiresAt));

        return Task.CompletedTask;
    }

    public Task<SessionRecord?> FindLiveAsync(string tokenHash, DateTimeOffset now, CancellationToken cancellationToken)
        => Task.FromResult<SessionRecord?>(null);

    public Task ExtendAsync(Guid sessionId, DateTimeOffset expiresAt, CancellationToken cancellationToken)
        => Task.CompletedTask;

    public Task RevokeAsync(Guid sessionId, DateTimeOffset revokedAt, CancellationToken cancellationToken)
        => Task.CompletedTask;

    public Task RevokeAllForUserAsync(Guid userId, DateTimeOffset revokedAt, CancellationToken cancellationToken)
    {
        RevokedUsers.Add(userId);

        return Task.CompletedTask;
    }
}

internal sealed class FakeTokenService : ITokenService
{
    public string CreateAccessToken(Guid userId, string email) => $"access-for-{userId}";

    public RefreshToken CreateRefreshToken() => new("raw-refresh-token", "hashed-refresh-token");

    public string HashRefreshToken(string refreshToken) => $"hash-of-{refreshToken}";
}

internal sealed class FakeGoogleTokenVerifier : IGoogleTokenVerifier
{
    public GoogleIdentity? Identity { get; set; }

    public Task<GoogleIdentity?> VerifyAsync(string idToken, CancellationToken cancellationToken)
        => Task.FromResult(Identity);
}

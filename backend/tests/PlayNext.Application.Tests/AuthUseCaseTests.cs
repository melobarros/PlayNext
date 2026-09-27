using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Application.Validation;
using PlayNext.Domain;

namespace PlayNext.Application.Tests;

/// <summary>
/// The auth use cases, against fakes — no database, no Identity, no Google.
///
/// What these tests can and cannot prove is worth stating plainly. They pin the
/// *orchestration*: that every way in funnels the guest document through one
/// merge, that the returned state is the canonical merged one, and that each
/// failure maps to the right outcome. They cannot prove the lockout counts to
/// five, because the counting is Identity's (research D10) and the fake simply
/// reports a verdict — that claim is only honestly verified against the real
/// stack in the gated integration suite (T017).
/// </summary>
public class AuthUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 27, 12, 0, 0, TimeSpan.Zero);

    private static GuestStatePayload Guest(params (string TitleId, string State)[] interactions)
    {
        return new GuestStatePayload(
            interactions.ToDictionary(
                entry => entry.TitleId,
                entry => new InteractionPayload(entry.State, "2026-09-27T10:00:00Z"),
                StringComparer.Ordinal),
            [new HistoryPayload("arrival", "2026-09-27T10:05:00Z")],
            null);
    }

    private sealed class Harness
    {
        public FakeAccountStore Accounts { get; } = new();

        public FakeAccountStateRepository States { get; } = new();

        public FakeSessionStore Sessions { get; } = new();

        public FakeTokenService Tokens { get; } = new();

        public FakeGoogleTokenVerifier Google { get; } = new();

        public AuthUseCases UseCases => new(Accounts, States, Sessions, Tokens, Google, new FixedClock(Now));
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakeAccountStore : IAccountStore
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

        public Task<bool> ChangePasswordAsync(
            Guid userId,
            string currentPassword,
            string newPassword,
            CancellationToken cancellationToken)
            => Task.FromResult(true);
    }

    /// <summary>
    /// The repository fake runs the real <see cref="MergeService"/>. A stubbed
    /// merge would make the losslessness assertions below test the stub.
    /// </summary>
    private sealed class FakeAccountStateRepository : IAccountStateRepository
    {
        private readonly Dictionary<Guid, AccountState> _byUser = [];

        public Task<AccountState> GetAsync(Guid userId, CancellationToken cancellationToken)
            => Task.FromResult(_byUser.GetValueOrDefault(userId, AccountState.Empty));

        public Task<AccountState> MergeIntoAccountAsync(
            Guid userId,
            AccountState incoming,
            CancellationToken cancellationToken)
        {
            var merged = MergeService.Merge(_byUser.GetValueOrDefault(userId, AccountState.Empty), incoming);

            // A merge that changed nothing stores nothing — the same "nothing is
            // written unless the merge succeeds" shape the real transaction has.
            _byUser[userId] = merged;

            return Task.FromResult(merged);
        }
    }

    private sealed class FakeSessionStore : ISessionStore
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

    private sealed class FakeTokenService : ITokenService
    {
        public string CreateAccessToken(Guid userId, string email) => $"access-for-{userId}";

        public RefreshToken CreateRefreshToken() => new("raw-refresh-token", "hashed-refresh-token");

        public string HashRefreshToken(string refreshToken) => $"hash-of-{refreshToken}";
    }

    private sealed class FakeGoogleTokenVerifier : IGoogleTokenVerifier
    {
        public GoogleIdentity? Identity { get; set; }

        public Task<GoogleIdentity?> VerifyAsync(string idToken, CancellationToken cancellationToken)
            => Task.FromResult(Identity);
    }

    public class Registering
    {
        [Fact]
        public async Task A_guest_document_is_carried_into_the_new_account()
        {
            // US1, the headline promise: register and lose nothing.
            var harness = new Harness();

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest("visitor@example.com", "Correct-Horse-9!", Guest(("arrival", "loved"))),
                "BR",
                CancellationToken.None);

            Assert.True(result.Succeeded);
            Assert.Equal(
                InteractionState.Loved,
                result.Session!.State.Interactions["arrival"].State);
            Assert.Single(result.Session.State.History);
        }

        [Fact]
        public async Task Registering_with_nothing_creates_an_empty_account()
        {
            // US1 scenario 4: a first-time visitor has nothing to migrate, and
            // that is a normal registration rather than an error.
            var harness = new Harness();

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest("visitor@example.com", "Correct-Horse-9!", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.True(result.Succeeded);
            Assert.Empty(result.Session!.State.Interactions);
            Assert.Null(result.Session.State.Preferences);
        }

        [Fact]
        public async Task A_taken_email_offers_signing_in_instead()
        {
            // FR-008. The message has to be actionable — "that email is taken"
            // with no next step is the dead end the product rules out.
            var harness = new Harness();
            harness.Accounts.Creation = AccountCreationStatus.EmailTaken;

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest("visitor@example.com", "Correct-Horse-9!", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.EmailTaken, result.Status);
            Assert.Contains(result.Errors, message => message.Contains("sign in", StringComparison.OrdinalIgnoreCase));
        }

        [Fact]
        public async Task A_malformed_email_never_reaches_the_account_store()
        {
            var harness = new Harness();

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest("not-an-email", "Correct-Horse-9!", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.InvalidPayload, result.Status);
            Assert.Empty(harness.Sessions.Stored);
        }

        [Fact]
        public async Task A_rejected_guest_document_fails_the_whole_registration()
        {
            // The document is a claim about data the visitor already owns. Half
            // accepting it would drop a rating without telling anyone, so the
            // request is refused instead.
            var harness = new Harness();

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest(
                    "visitor@example.com",
                    "Correct-Horse-9!",
                    Guest(("arrival", "adored"))),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.InvalidPayload, result.Status);
            Assert.Empty(harness.Sessions.Stored);
        }

        [Fact]
        public async Task A_successful_registration_leaves_a_session_behind()
        {
            // The refresh token reaches the client once; only its hash is kept.
            var harness = new Harness();

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest("visitor@example.com", "Correct-Horse-9!", Guest: null),
                "BR",
                CancellationToken.None);

            var stored = Assert.Single(harness.Sessions.Stored);
            Assert.Equal("hashed-refresh-token", stored.Hash);
            Assert.DoesNotContain("raw-refresh-token", stored.Hash);
            Assert.Equal(Now + AuthUseCases.RefreshLifetime, stored.ExpiresAt);
            Assert.Equal("access-for-" + stored.UserId, result.Session!.AccessToken);
        }
    }

    public class SigningIn
    {
        [Fact]
        public async Task The_guest_document_merges_into_the_existing_account()
        {
            // US3: signing in is the same migration as registering, over an
            // account that already has data.
            var harness = new Harness();
            harness.Accounts.Seed("visitor@example.com");
            var account = await harness.Accounts.FindByEmailAsync(
                "visitor@example.com",
                CancellationToken.None);
            var seeded = GuestStateValidator.Validate(Guest(("hereditary", "disliked")));
            await harness.States.MergeIntoAccountAsync(account!.Id, seeded.Value!, CancellationToken.None);

            var result = await harness.UseCases.SignInAsync(
                new LoginRequest("visitor@example.com", "Correct-Horse-9!", Guest(("arrival", "loved"))),
                "BR",
                CancellationToken.None);

            Assert.True(result.Succeeded);
            Assert.Equal(2, result.Session!.State.Interactions.Count);
            Assert.Contains("hereditary", result.Session.State.ExcludedTitleIds);
            Assert.Contains("arrival", result.Session.State.Interactions.Keys);
        }

        [Fact]
        public async Task Wrong_credentials_are_generic()
        {
            // FR-011: never reveal whether the address exists.
            var harness = new Harness();
            harness.Accounts.Check = CredentialCheck.InvalidCredentials;

            var result = await harness.UseCases.SignInAsync(
                new LoginRequest("visitor@example.com", "wrong", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.InvalidCredentials, result.Status);
            Assert.Empty(harness.Sessions.Stored);

            var message = Assert.Single(result.Errors);
            Assert.DoesNotContain("email", message, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("password", message, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public async Task A_lockout_reports_how_long_to_wait()
        {
            // FR-011: the visitor is told when they can try again, rather than
            // being left at a door that silently will not open.
            var harness = new Harness();
            harness.Accounts.Check = CredentialCheck.LockedOut;
            harness.Accounts.LockoutRemaining = TimeSpan.FromMinutes(12);

            var result = await harness.UseCases.SignInAsync(
                new LoginRequest("visitor@example.com", "Correct-Horse-9!", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.LockedOut, result.Status);
            Assert.Equal(TimeSpan.FromMinutes(12), result.RetryAfter);
        }
    }

    public class GoogleSigningIn
    {
        [Fact]
        public async Task A_verified_identity_signs_in()
        {
            var harness = new Harness();
            harness.Google.Identity = new GoogleIdentity("google-sub", "visitor@example.com", EmailVerified: true);

            var result = await harness.UseCases.GoogleSignInAsync(
                new GoogleRequest("google-id-token", Guest(("arrival", "loved"))),
                "BR",
                CancellationToken.None);

            Assert.True(result.Succeeded);
            Assert.Equal(InteractionState.Loved, result.Session!.State.Interactions["arrival"].State);
        }

        [Fact]
        public async Task An_unverifiable_token_is_refused()
        {
            var harness = new Harness();
            harness.Google.Identity = null;

            var result = await harness.UseCases.GoogleSignInAsync(
                new GoogleRequest("forged-token", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.InvalidCredentials, result.Status);
            Assert.Empty(harness.Sessions.Stored);
        }

        [Fact]
        public async Task An_unverified_email_is_never_linked_to_an_existing_account()
        {
            // The account-takeover case: without this check, anyone who could
            // create a Google account claiming someone else's address would be
            // signed into that person's PlayNext account (FR-009).
            var harness = new Harness();
            harness.Accounts.Seed("visitor@example.com");
            harness.Google.Identity = new GoogleIdentity("google-sub", "visitor@example.com", EmailVerified: false);

            var result = await harness.UseCases.GoogleSignInAsync(
                new GoogleRequest("google-id-token", Guest: null),
                "BR",
                CancellationToken.None);

            Assert.Equal(AuthStatus.InvalidCredentials, result.Status);
            Assert.Empty(harness.Sessions.Stored);
        }
    }
}

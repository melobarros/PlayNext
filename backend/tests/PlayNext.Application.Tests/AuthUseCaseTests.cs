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

    public class Registering
    {
        [Fact]
        public async Task A_guest_document_is_carried_into_the_new_account()
        {
            // US1, the headline promise: register and lose nothing.
            var harness = new Harness();

            var result = await harness.UseCases.RegisterAsync(
                new RegisterRequest("visitor@example.com", "Correct-Horse-9!", Harness.Guest(("arrival", "loved"))),
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
                    Harness.Guest(("arrival", "adored"))),
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
            Assert.Equal(Harness.Now + AuthUseCases.RefreshLifetime, stored.ExpiresAt);
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
            var seeded = GuestStateValidator.Validate(Harness.Guest(("hereditary", "disliked")));
            await harness.States.MergeIntoAccountAsync(account!.Id, seeded.Value!, CancellationToken.None);

            var result = await harness.UseCases.SignInAsync(
                new LoginRequest("visitor@example.com", "Correct-Horse-9!", Harness.Guest(("arrival", "loved"))),
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
                new GoogleRequest("google-id-token", Harness.Guest(("arrival", "loved"))),
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

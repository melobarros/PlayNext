using PlayNext.Application.Contracts;

namespace PlayNext.Application.Tests;

/// <summary>
/// Changing a password (FR-014), against fakes — the orchestration around the
/// two collaborators that own the hard parts.
///
/// The claim this suite exists for is the revocation. Identity verifies the
/// current password and applies the policy, and both of those are verified
/// where they happen (the store, and the gated integration suite); what the use
/// case decides is *what happens after a successful change*, and the answer is
/// that every session for the account ends — including the one that asked. A
/// password is changed because it may be known to someone else. Leaving the
/// session that made the change alive leaves a session that may be the
/// someone else's, which is the one outcome that makes the feature pointless.
/// </summary>
public class ChangePasswordTests
{
    private static readonly Guid UserId = Guid.Parse("0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11");

    private static ChangePasswordRequest Request(
        string current = "Correct-Horse-9!",
        string replacement = "Battery-Staple-7!")
    {
        return new ChangePasswordRequest(current, replacement);
    }

    [Fact]
    public async Task A_successful_change_ends_every_session()
    {
        var harness = new Harness();

        var result = await harness.UseCases.ChangePasswordAsync(UserId, Request(), CancellationToken.None);

        Assert.True(result.Succeeded);

        // Exactly once. A second revocation would be harmless here and wrong in
        // principle — "revoke everything" is one instruction, and a call per
        // session is a different implementation of it that would need to
        // enumerate sessions this use case has no way to see.
        Assert.Equal([UserId], harness.Sessions.RevokedUsers);
    }

    [Fact]
    public async Task The_change_is_addressed_to_the_session_that_asked_for_it()
    {
        // The id comes from the bearer token's `sub` claim and nowhere else. A
        // use case that took the account from the request body would let any
        // signed-in visitor change anyone's password; the assertion is on what
        // reached the store rather than on the call signature, because that is
        // where the mistake would actually live.
        var harness = new Harness();

        await harness.UseCases.ChangePasswordAsync(UserId, Request(), CancellationToken.None);

        var change = Assert.Single(harness.Accounts.Changes);

        Assert.Equal(UserId, change.UserId);
        Assert.Equal("Correct-Horse-9!", change.CurrentPassword);
        Assert.Equal("Battery-Staple-7!", change.NewPassword);
    }

    [Fact]
    public async Task A_wrong_current_password_changes_nothing_at_all()
    {
        // FR-014's "confirms the current password first", and the negative half
        // matters as much as the message: an account whose password was not
        // changed must not have had its sessions ended either, or a visitor who
        // mistyped would be signed out of every device they own.
        var harness = new Harness();
        harness.Accounts.CurrentPasswordMatches = false;

        var result = await harness.UseCases.ChangePasswordAsync(UserId, Request(), CancellationToken.None);

        Assert.Equal(ChangePasswordStatus.InvalidCredentials, result.Status);
        Assert.Empty(harness.Sessions.RevokedUsers);
    }

    [Fact]
    public async Task A_wrong_current_password_is_refused_generically()
    {
        // FR-011's rule, applied to the one endpoint that has a signed-in
        // caller and therefore could afford to be specific. It must not be:
        // "wrong current password" and "no such account" are the same answer
        // everywhere else in this API, and an endpoint that says which is an
        // oracle for a borrowed session to probe with.
        var harness = new Harness();
        harness.Accounts.CurrentPasswordMatches = false;

        var result = await harness.UseCases.ChangePasswordAsync(UserId, Request(), CancellationToken.None);

        var message = Assert.Single(result.Errors);

        Assert.Equal("Those details did not match an account.", message);
    }

    [Fact]
    public async Task A_rejected_new_password_comes_back_as_its_own_outcome()
    {
        // FR-010. Separate from the wrong-password answer because the two lead
        // to different screens: one is "try again", the other is "choose a
        // different password". Collapsing them would tell a visitor their
        // password was wrong when the API never looked at it.
        var harness = new Harness();
        harness.Accounts.WeakNewPassword = ["Passwords must have at least one non alphanumeric character."];

        var result = await harness.UseCases.ChangePasswordAsync(
            UserId,
            Request(replacement: "alllowercase"),
            CancellationToken.None);

        Assert.Equal(ChangePasswordStatus.PasswordRejected, result.Status);

        // Identity's own wording, passed through. Restating it here would be a
        // second copy of the policy, and the copy is what would go stale.
        Assert.Equal(
            "Passwords must have at least one non alphanumeric character.",
            Assert.Single(result.Errors));
    }

    [Fact]
    public async Task A_rejected_new_password_ends_no_sessions()
    {
        // The password did not change, so nothing that was true before is false
        // now. Revoking here would sign a visitor out of every device because
        // they picked a password the policy did not like.
        var harness = new Harness();
        harness.Accounts.WeakNewPassword = ["Too short."];

        await harness.UseCases.ChangePasswordAsync(UserId, Request(replacement: "short"), CancellationToken.None);

        Assert.Empty(harness.Sessions.RevokedUsers);
    }

    [Fact]
    public async Task A_missing_password_field_is_a_wrong_password_rather_than_a_crash()
    {
        // The body is `string?` on both fields because it comes off the wire,
        // and a client that omits one must get an ordinary refusal. Identity
        // would throw on a null argument, which would surface as a 500 — a
        // server error for what is really a malformed request.
        var harness = new Harness();
        harness.Accounts.CurrentPasswordMatches = false;

        var result = await harness.UseCases.ChangePasswordAsync(
            UserId,
            new ChangePasswordRequest(null, null),
            CancellationToken.None);

        Assert.Equal(ChangePasswordStatus.InvalidCredentials, result.Status);

        var change = Assert.Single(harness.Accounts.Changes);

        // Empty rather than null, and never a literal "null" string.
        Assert.Equal(string.Empty, change.CurrentPassword);
        Assert.Equal(string.Empty, change.NewPassword);
    }
}

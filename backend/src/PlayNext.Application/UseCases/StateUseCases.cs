using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.Validation;
using PlayNext.Domain;

namespace PlayNext.Application.UseCases;

/// <summary>
/// The two state endpoints (contracts/api.md): read the account, and apply a
/// partial body to it.
///
/// This class decides *when* a merge happens, never *how* — the rule is
/// <see cref="MergeService"/>'s, reached through
/// <see cref="IAccountStateRepository"/>, exactly as on the auth path. That
/// shared route is the point: a live push, an offline replay and a sign-in
/// migration are three callers of one rule, and the difference between them is
/// only how much of the document the body happens to carry.
///
/// A body is *items to apply*, never a description of the whole account. An
/// omitted collection means "no news", which is what lets the live caller send
/// one changed rating without the server reading the silence as a deletion.
/// </summary>
public sealed class StateUseCases(IAccountStateRepository states)
{
    /// <summary><c>GET /me/state</c> — the canonical account, for a device whose cache is behind.</summary>
    public Task<AccountState> GetAsync(Guid userId, CancellationToken cancellationToken) =>
        states.GetAsync(userId, cancellationToken);

    /// <summary>
    /// <c>POST /me/sync</c> — validate the body, merge it, and answer with the
    /// account as it now stands.
    /// </summary>
    /// <remarks>
    /// Validation happens before the repository is touched, so a body refused
    /// for one bad item cannot have applied the good ones on the way to noticing
    /// (FR-007). The returned state is the merge result rather than the body,
    /// because the client writes it straight back to its cache: handing back
    /// only what was sent would leave the device believing that is all it owns.
    /// </remarks>
    public async Task<SyncResult> SyncAsync(
        Guid userId,
        GuestStatePayload? payload,
        CancellationToken cancellationToken)
    {
        var incoming = GuestStateValidator.Validate(payload);

        if (!incoming.IsValid)
        {
            return SyncResult.Failure(incoming.Errors);
        }

        var merged = await states.MergeIntoAccountAsync(userId, incoming.Value!, cancellationToken);

        return SyncResult.Success(merged);
    }
}

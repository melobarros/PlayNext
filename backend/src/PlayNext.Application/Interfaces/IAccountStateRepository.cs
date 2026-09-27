using PlayNext.Domain;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The account store, as the use cases see it.
///
/// Persistence sits behind an interface so the use cases — register, sign in,
/// sync — are readable without a database in the room, and so the merge rule
/// can be exercised without one (constitution VII).
/// </summary>
public interface IAccountStateRepository
{
    /// <summary>The account's canonical state. An account that has never synced reads as empty.</summary>
    Task<AccountState> GetAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// Merges <paramref name="incoming"/> into the account and returns the
    /// resulting canonical state.
    /// </summary>
    /// <remarks>
    /// Read-merge-write happens inside one transaction, which is what makes
    /// FR-007 true: an interrupted migration leaves the account exactly as it
    /// was, so the device's document is still the only copy of that data and
    /// re-sending it is safe.
    ///
    /// The merge itself is <see cref="MergeService"/>'s — the rule is
    /// implemented once and called from here, not restated as SQL.
    /// </remarks>
    Task<AccountState> MergeIntoAccountAsync(
        Guid userId,
        AccountState incoming,
        CancellationToken cancellationToken);
}

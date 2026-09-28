using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Application.Tests;

/// <summary>
/// An <see cref="IAccountStateRepository"/> over a dictionary, running the real
/// <see cref="MergeService"/>.
///
/// The real merge, not a stub: the auth and sync suites are here to pin the
/// orchestration *around* the rule, and a fake that resolved conflicts itself
/// would turn every newest-wins assertion into a test of the fake.
///
/// "Nothing is written unless the document is accepted" is a property of the
/// callers rather than of this class — validation runs before the merge is ever
/// reached, so a rejected body never arrives. The auth suite relies on that for
/// FR-007, which is why <see cref="Stored"/> is exposed: it is how a test shows
/// the account was left alone.
///
/// One copy, shared by both suites, so they cannot drift into describing
/// different accounts.
/// </summary>
internal sealed class InMemoryAccountStateRepository : IAccountStateRepository
{
    private readonly Dictionary<Guid, AccountState> _byUser = [];

    /// <summary>What the account actually holds, without going through the read path under test.</summary>
    public AccountState Stored(Guid userId) => _byUser.GetValueOrDefault(userId, AccountState.Empty);

    public Task<AccountState> GetAsync(Guid userId, CancellationToken cancellationToken)
        => Task.FromResult(Stored(userId));

    public Task<AccountState> MergeIntoAccountAsync(
        Guid userId,
        AccountState incoming,
        CancellationToken cancellationToken)
    {
        var merged = MergeService.Merge(Stored(userId), incoming);

        _byUser[userId] = merged;

        return Task.FromResult(merged);
    }
}

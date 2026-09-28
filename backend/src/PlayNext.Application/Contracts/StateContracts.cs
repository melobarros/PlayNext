using PlayNext.Domain;

namespace PlayNext.Application.Contracts;

/// <summary>
/// The outcome of a sync: the canonical state, or the reasons the body was
/// refused.
/// </summary>
/// <remarks>
/// Shaped after <see cref="AuthResult"/>, and for the same reason: a rejected
/// body is a value the endpoint turns into a 400 with messages, not an
/// exception. There is one failure status rather than auth's several because
/// every way a sync body can be wrong is the same answer — the document did not
/// describe an account state, and nothing was written.
/// </remarks>
public sealed record SyncResult(SyncStatus Status, AccountState? State, IReadOnlyList<string> Errors)
{
    /// <summary>The body was applied; this is the account as it now stands.</summary>
    public static SyncResult Success(AccountState state) => new(SyncStatus.Succeeded, state, []);

    /// <summary>The body was refused whole (contracts/api.md).</summary>
    public static SyncResult Failure(IReadOnlyList<string> errors) =>
        new(SyncStatus.InvalidPayload, null, errors);

    public bool Succeeded => Status == SyncStatus.Succeeded;
}

public enum SyncStatus
{
    /// <summary>Applied, and the merged state returned.</summary>
    Succeeded,

    /// <summary>The request body was malformed. Nothing was written.</summary>
    InvalidPayload,
}

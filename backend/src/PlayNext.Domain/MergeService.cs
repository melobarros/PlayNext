namespace PlayNext.Domain;

/// <summary>
/// The guest→account migration rule, and the feature's named critical path
/// (constitution V names "the guest→account migration" among the paths that
/// MUST be test-first).
///
/// It is a Domain service on purpose. The rule decides what a visitor's data
/// means after they sign in, and that meaning must not differ depending on
/// whether it was computed on a phone or a server — so it lives in exactly one
/// place, in the layer with no framework, no database, and no HTTP
/// (constitution VII). Both the register path and the sign-in path call it, and
/// so does the offline replay; the rule is implemented once.
///
/// The rule is union plus newest-wins, per record:
/// <list type="bullet">
///   <item>A title only one side knows about is kept.</item>
///   <item>A title both sides rated takes the newer <c>updatedAt</c>.</item>
///   <item>An exact timestamp tie goes to the <b>account</b> — a deterministic
///   tie-break, because "whichever the framework enumerated first" is not a
///   rule (constitution VI: reproducible from the same inputs).</item>
///   <item>The watching log is a union that never duplicates an entry and never
///   removes one, which is what makes a retried migration idempotent.</item>
///   <item>Preferences are whole-document newest-wins, never field-merged.</item>
/// </list>
/// </summary>
public static class MergeService
{
    /// <summary>
    /// Merges <paramref name="incoming"/> (the device's guest data, or a partial
    /// set of offline changes) into <paramref name="account"/>.
    /// </summary>
    /// <remarks>
    /// Pure: neither argument is modified, and the result shares no mutable
    /// state with either. A failed migration therefore leaves the device's data
    /// exactly as it was (FR-007).
    /// </remarks>
    public static AccountState Merge(AccountState account, AccountState incoming)
    {
        return new AccountState(
            MergeInteractions(account.Interactions, incoming.Interactions),
            MergeHistory(account.History, incoming.History),
            MergePreferences(account.Preferences, incoming.Preferences));
    }

    /// <summary>
    /// Union with newest-wins. The comparison is strictly greater, which is the
    /// whole of the tie rule: an equal timestamp leaves the account's record in
    /// place (research D4).
    /// </summary>
    private static Dictionary<string, InteractionRecord> MergeInteractions(
        IReadOnlyDictionary<string, InteractionRecord> account,
        IReadOnlyDictionary<string, InteractionRecord> incoming)
    {
        var merged = new Dictionary<string, InteractionRecord>(account, StringComparer.Ordinal);

        foreach (var (titleId, candidate) in incoming)
        {
            if (!merged.TryGetValue(titleId, out var existing) || candidate.UpdatedAt > existing.UpdatedAt)
            {
                merged[titleId] = candidate;
            }
        }

        return merged;
    }

    /// <summary>
    /// The watching log as a union that never duplicates and never removes. An
    /// entry is the pair <c>(titleId, chosenAt)</c>, so the same title watched
    /// on two occasions stays two entries, while the same entry arriving twice —
    /// a retried migration — stays one (FR-007).
    /// </summary>
    private static List<WatchHistoryEntry> MergeHistory(
        IReadOnlyList<WatchHistoryEntry> account,
        IReadOnlyList<WatchHistoryEntry> incoming)
    {
        var merged = new List<WatchHistoryEntry>(account);
        var seen = account
            .Select(entry => (entry.TitleId, entry.ChosenAt))
            .ToHashSet();

        foreach (var entry in incoming)
        {
            if (seen.Add((entry.TitleId, entry.ChosenAt)))
            {
                merged.Add(entry);
            }
        }

        return merged;
    }

    /// <summary>
    /// Whole-document newest-wins, with the same account-wins tie rule. Never
    /// field-merged: a side with no preferences at all leaves the other's
    /// untouched rather than blanking them.
    /// </summary>
    private static PreferenceRecord? MergePreferences(PreferenceRecord? account, PreferenceRecord? incoming)
    {
        if (incoming is null)
        {
            return account;
        }

        return account is null || incoming.UpdatedAt > account.UpdatedAt ? incoming : account;
    }
}

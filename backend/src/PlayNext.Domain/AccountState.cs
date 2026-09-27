namespace PlayNext.Domain;

/// <summary>
/// One selected dimension of the onboarding quiz (001's <c>DimensionChoice</c>).
/// <paramref name="Any"/> is the "Any / No preference" chip, which is exclusive:
/// when it is true, <paramref name="Values"/> is empty. The two are kept as one
/// record so that invariant cannot be represented wrongly by half of it.
/// </summary>
public sealed record DimensionChoice(IReadOnlyList<string> Values, bool Any)
{
    /// <summary>An "Any" choice — no specific values, the chip selected.</summary>
    public static readonly DimensionChoice NoPreference = new([], true);
}

/// <summary>
/// One rating in an account or on a device. The title id is the key in the
/// surrounding map, exactly as in 002's storage contract — carrying it here too
/// would create a second place for it to disagree.
/// </summary>
public sealed record InteractionRecord(InteractionState State, DateTimeOffset UpdatedAt);

/// <summary>
/// One entry in the watching log (002/003's <c>WatchHistoryEntry</c>). The log
/// is append-only: nothing in this feature removes an entry.
/// </summary>
public sealed record WatchHistoryEntry(string TitleId, DateTimeOffset ChosenAt);

/// <summary>
/// The account copy of 001's completed <c>QuizState</c>. Stored as one coherent
/// value rather than mergeable fields, because the quiz is a single set of
/// choices — a field-by-field merge could produce a combination the visitor
/// never chose (research D4).
/// </summary>
public sealed record PreferenceRecord(
    DimensionChoice MediaType,
    DimensionChoice Genre,
    DimensionChoice Provider,
    bool IncludeUnownedProviders,
    DateTimeOffset CompletedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// Everything a visitor owns: their ratings, their watching log, and their quiz
/// preferences. The same shape describes a device's guest data and an account's
/// server-side data, which is what lets migration be a merge of two values of
/// one type rather than a translation between two models.
///
/// The one asymmetry is <see cref="Removals"/>: a removal is an *instruction*
/// about a rating rather than a rating, so it is meaningful only on the
/// incoming side, and the merge's output never carries one. It lives here
/// rather than in a type of its own because everything else about the two sides
/// is identical, and splitting the type would mean writing the merge twice.
///
/// Immutable by construction — every collection is copied on the way in, so a
/// caller cannot mutate a state it handed to the merge. The merge is pure and
/// this is what makes it so.
/// </summary>
public sealed class AccountState
{
    private static readonly IReadOnlyDictionary<string, DateTimeOffset> NoRemovals =
        new Dictionary<string, DateTimeOffset>();

    /// <summary>An account that has never been used: nothing rated, nothing watched, no quiz.</summary>
    public static readonly AccountState Empty =
        new(new Dictionary<string, InteractionRecord>(), [], null);

    public AccountState(
        IReadOnlyDictionary<string, InteractionRecord> interactions,
        IReadOnlyList<WatchHistoryEntry> history,
        PreferenceRecord? preferences,
        IReadOnlyDictionary<string, DateTimeOffset>? removals = null)
    {
        Interactions = new Dictionary<string, InteractionRecord>(interactions, StringComparer.Ordinal);
        History = [.. history];
        Preferences = preferences;
        Removals = removals is null
            ? NoRemovals
            : new Dictionary<string, DateTimeOffset>(removals, StringComparer.Ordinal);
    }

    /// <summary>Ratings, keyed by title id. One rating per title, by construction.</summary>
    public IReadOnlyDictionary<string, InteractionRecord> Interactions { get; }

    /// <summary>The watching log, append-only.</summary>
    public IReadOnlyList<WatchHistoryEntry> History { get; }

    /// <summary>The completed quiz, or <c>null</c> for a visitor who never finished one.</summary>
    public PreferenceRecord? Preferences { get; }

    /// <summary>
    /// Titles the incoming side asked to unrate, each with the moment it asked
    /// (FR-006). Empty on an account's stored state, and empty on every merge
    /// result — see the class remarks.
    /// </summary>
    /// <remarks>
    /// The timestamp is what lets a removal be compared with the account's
    /// rating by the same newest-wins rule as everything else. A bare "delete
    /// this" could only ever win or always lose, and neither is right when two
    /// devices disagree about a title.
    /// </remarks>
    public IReadOnlyDictionary<string, DateTimeOffset> Removals { get; }

    /// <summary>
    /// The title ids the deck must not suggest (002's Feedback Loop invariant:
    /// Disliked and Not Interested are never suggested again). Derived from the
    /// current ratings at read time and never stored — a stored list would have
    /// to be kept in step with every re-rating and removal.
    /// </summary>
    public IReadOnlySet<string> ExcludedTitleIds =>
        Interactions
            .Where(entry => InteractionStates.Excludes(entry.Value.State))
            .Select(entry => entry.Key)
            .ToHashSet(StringComparer.Ordinal);
}

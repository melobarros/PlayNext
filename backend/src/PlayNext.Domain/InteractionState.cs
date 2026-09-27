namespace PlayNext.Domain;

/// <summary>
/// The rating vocabulary — the ubiquitous language the constitution requires to
/// be shared across domain, API, and UI (the Engineering Standards' "Architecture
/// and Patterns" section).
///
/// These six values are the same six the frontend has used since spec 002, and
/// the same six the 002 storage contract freezes. The names differ in case only
/// (C# enums are PascalCase, the wire format is camelCase), which is what
/// <see cref="InteractionStates"/> exists to bridge — deliberately in one place
/// rather than as an attribute sprinkled per member.
/// </summary>
public enum InteractionState
{
    /// <summary>A title the visitor loved.</summary>
    Loved,

    /// <summary>A title the visitor liked — shares the Loved surface with <see cref="Loved"/>.</summary>
    Liked,

    /// <summary>A title the visitor disliked. <b>Excludes</b> the title from suggestions.</summary>
    Disliked,

    /// <summary>A title saved for later.</summary>
    WantToWatch,

    /// <summary>A title the visitor is not interested in. <b>Excludes</b> it from suggestions.</summary>
    NotInterested,

    /// <summary>A title the visitor locked in with Watch Now. Lives in the history surface, not a tab.</summary>
    WatchingNow,
}

/// <summary>
/// Translation between <see cref="InteractionState"/> and the wire vocabulary.
///
/// The wire names are load-bearing: they are what specs 002/003 already write to
/// LocalStorage, what the API accepts and returns, and what the client stores.
/// A rename here silently invalidates every stored document, so the table is
/// explicit and the round trip is covered by tests.
/// </summary>
public static class InteractionStates
{
    private static readonly Dictionary<InteractionState, string> ToWireNames = new()
    {
        [InteractionState.Loved] = "loved",
        [InteractionState.Liked] = "liked",
        [InteractionState.Disliked] = "disliked",
        [InteractionState.WantToWatch] = "wantToWatch",
        [InteractionState.NotInterested] = "notInterested",
        [InteractionState.WatchingNow] = "watchingNow",
    };

    private static readonly Dictionary<string, InteractionState> FromWireNames =
        ToWireNames.ToDictionary(pair => pair.Value, pair => pair.Key, StringComparer.Ordinal);

    /// <summary>All six states, in the vocabulary's declared order.</summary>
    public static readonly IReadOnlyList<InteractionState> All = ToWireNames.Keys.ToList();

    /// <summary>
    /// The states that exclude a title from suggestions (002's
    /// <c>EXCLUDING_STATES</c>). Derived from the vocabulary rather than stored
    /// separately, so the exclusion set cannot drift from the ratings it comes
    /// from — the rule both 002 and 003 depend on.
    /// </summary>
    public static readonly IReadOnlyList<InteractionState> Excluding =
        [InteractionState.Disliked, InteractionState.NotInterested];

    /// <summary>The wire name, e.g. <c>wantToWatch</c>.</summary>
    public static string ToWire(InteractionState state) => ToWireNames[state];

    /// <summary>
    /// Parses a wire name. Returns <c>false</c> for anything outside the
    /// vocabulary — the caller decides whether that is a 400 or a discarded
    /// document, but it is never silently accepted.
    /// </summary>
    public static bool TryParse(string? wireName, out InteractionState state)
    {
        state = default;

        return wireName is not null && FromWireNames.TryGetValue(wireName, out state);
    }

    /// <summary>Whether a state excludes its title from suggestions.</summary>
    public static bool Excludes(InteractionState state) => Excluding.Contains(state);
}

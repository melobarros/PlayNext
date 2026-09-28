using PlayNext.Domain;

namespace PlayNext.Api.Contracts;

/// <summary>
/// One rating, as the wire spells it.
///
/// <see cref="State"/> is the wire name (<c>"wantToWatch"</c>) rather than the
/// enum, and that is the whole reason this type exists. The serializer would
/// otherwise write the enum as its ordinal — a bare <c>4</c> — which is not the
/// 002 storage contract, and which would silently mean something different if
/// the C# enum were ever reordered. <see cref="InteractionStates"/> is the one
/// place that mapping lives (constitution: the vocabulary is shared, not
/// re-derived).
/// </summary>
public sealed record InteractionView(string State, DateTimeOffset UpdatedAt);

/// <summary>One watching-log entry, as the wire spells it.</summary>
public sealed record HistoryView(string TitleId, DateTimeOffset ChosenAt);

/// <summary>One quiz dimension, as the wire spells it — the 001 <c>{values, any}</c> shape.</summary>
public sealed record DimensionChoiceView(IReadOnlyList<string> Values, bool Any);

/// <summary>The completed quiz, as the wire spells it.</summary>
public sealed record PreferenceView(
    DimensionChoiceView MediaType,
    DimensionChoiceView Genre,
    DimensionChoiceView Provider,
    bool IncludeUnownedProviders,
    DateTimeOffset CompletedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// The canonical account state — <c>{ interactions, history, preferences }</c>,
/// the same shape the device stores and the sync body carries (contracts/api.md).
///
/// A view rather than <see cref="AccountState"/> itself, for two reasons that
/// both matter: the domain type's <c>ExcludedTitleIds</c> is derived at read
/// time and is not part of the contract, and the domain type must not grow
/// serialization concerns to satisfy a transport shape (constitution VII).
/// </summary>
public sealed record AccountStateView(
    IReadOnlyDictionary<string, InteractionView> Interactions,
    IReadOnlyList<HistoryView> History,
    PreferenceView? Preferences)
{
    /// <summary>Projects a domain state onto the wire shape.</summary>
    public static AccountStateView From(AccountState state)
    {
        return new AccountStateView(
            state.Interactions.ToDictionary(
                entry => entry.Key,
                entry => new InteractionView(
                    InteractionStates.ToWire(entry.Value.State),
                    entry.Value.UpdatedAt),
                StringComparer.Ordinal),
            [.. state.History.Select(entry => new HistoryView(entry.TitleId, entry.ChosenAt))],
            state.Preferences is { } preferences
                ? new PreferenceView(
                    Choice(preferences.MediaType),
                    Choice(preferences.Genre),
                    Choice(preferences.Provider),
                    preferences.IncludeUnownedProviders,
                    preferences.CompletedAt,
                    preferences.UpdatedAt)
                : null);
    }

    private static DimensionChoiceView Choice(DimensionChoice choice)
        => new([.. choice.Values], choice.Any);
}

/// <summary>
/// What a successful sign-in returns: who is signed in, the access token, and
/// the canonical state.
///
/// The refresh token is deliberately not here. It travels only as an httpOnly
/// cookie, so it never reaches script — which is what makes an XSS unable to
/// walk away with a long-lived credential (research D6).
/// </summary>
/// <param name="UserId">
/// The device's session marker records the signed-in account
/// (contracts/device-storage.md), so the client needs the id. It is not a
/// secret — the caller holds a token for this user — and it is returned as a
/// string because that is what a JSON client stores.
/// </param>
/// <param name="Email">
/// The marker's display field. The client cannot supply it on the Google path,
/// where the address is chosen inside Google's own sheet.
/// </param>
public sealed record SessionResponse(
    string UserId,
    string Email,
    string AccessToken,
    AccountStateView State);

/// <summary>The refresh endpoint's response: a new access token, and nothing else.</summary>
public sealed record RefreshResponse(string AccessToken);

/// <summary>
/// A failure the client can act on. <paramref name="RetryAfterSeconds"/> is
/// present only for a lockout, where waiting is the action (FR-011).
/// </summary>
public sealed record ErrorResponse(string Code, IReadOnlyList<string> Errors, int? RetryAfterSeconds = null);

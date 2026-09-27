namespace PlayNext.Application.Contracts;

/// <summary>
/// The device document as it arrives over the wire (contracts/api.md).
///
/// Every leaf is a <c>string?</c> rather than a parsed type on purpose. If the
/// state were an enum, JSON deserialization would throw before validation ever
/// ran, and the caller would get a serializer error instead of the contract's
/// 400 with a reason. Keeping the raw text means an unknown state is a
/// *validation* outcome — which is the thing the 002 contract insists on
/// rejecting loudly rather than skipping.
/// </summary>
public sealed record GuestStatePayload(
    IReadOnlyDictionary<string, InteractionPayload>? Interactions,
    IReadOnlyList<HistoryPayload>? History,
    PreferencePayload? Preferences);

/// <summary>One rating, as sent. <paramref name="TitleId"/> is the map key.</summary>
public sealed record InteractionPayload(string? State, string? UpdatedAt);

/// <summary>One watching-log entry, as sent.</summary>
public sealed record HistoryPayload(string? TitleId, string? ChosenAt);

/// <summary>One quiz dimension, in the 001 contract's <c>{values, any}</c> shape.</summary>
public sealed record DimensionChoicePayload(IReadOnlyList<string>? Values, bool Any);

/// <summary>The completed quiz, as sent.</summary>
public sealed record PreferencePayload(
    DimensionChoicePayload? MediaType,
    DimensionChoicePayload? Genre,
    DimensionChoicePayload? Provider,
    bool IncludeUnownedProviders,
    string? CompletedAt,
    string? UpdatedAt);

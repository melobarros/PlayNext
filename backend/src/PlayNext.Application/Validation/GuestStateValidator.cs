using System.Globalization;
using PlayNext.Application.Contracts;
using PlayNext.Domain;

namespace PlayNext.Application.Validation;

/// <summary>
/// Turns a wire document into the domain's <see cref="AccountState"/>, or says
/// why it cannot.
///
/// This is the server's counterpart to the 002 storage contract's read rules.
/// The device is forgiving about its own documents (a document written by an
/// older build is rebuilt rather than lost); the server is not, because a
/// request body is a claim about data the visitor already owns, and quietly
/// reinterpreting one is worse than refusing it.
/// </summary>
public static class GuestStateValidator
{
    /// <summary>
    /// Validates and converts. A null payload is valid and yields
    /// <see cref="AccountState.Empty"/>: a guest who never rated anything
    /// registers into an empty account (US1 scenario 4), which is a normal
    /// outcome rather than an error.
    /// </summary>
    /// <remarks>
    /// Every problem is collected before returning. Reporting only the first
    /// would make a client fix one field per round trip, and the caller is
    /// usually a device replaying a queue it cannot inspect.
    /// </remarks>
    public static ValidationOutcome<AccountState> Validate(GuestStatePayload? payload)
    {
        if (payload is null)
        {
            return ValidationOutcome<AccountState>.Valid(AccountState.Empty);
        }

        var errors = new List<string>();
        var interactions = new Dictionary<string, InteractionRecord>(StringComparer.Ordinal);

        foreach (var (titleId, entry) in payload.Interactions ?? EmptyInteractions)
        {
            if (string.IsNullOrWhiteSpace(titleId))
            {
                errors.Add("An interaction has an empty title id.");
                continue;
            }

            if (!InteractionStates.TryParse(entry.State, out var state))
            {
                errors.Add($"'{titleId}' has an unknown state '{entry.State}'.");
                continue;
            }

            if (!TryParseTimestamp(entry.UpdatedAt, out var updatedAt))
            {
                errors.Add($"'{titleId}' has an unreadable updatedAt '{entry.UpdatedAt}'.");
                continue;
            }

            interactions[titleId] = new InteractionRecord(state, updatedAt);
        }

        var history = new List<WatchHistoryEntry>();

        foreach (var entry in payload.History ?? [])
        {
            if (string.IsNullOrWhiteSpace(entry.TitleId))
            {
                errors.Add("A watching-log entry has an empty title id.");
                continue;
            }

            if (!TryParseTimestamp(entry.ChosenAt, out var chosenAt))
            {
                errors.Add($"'{entry.TitleId}' has an unreadable chosenAt '{entry.ChosenAt}'.");
                continue;
            }

            history.Add(new WatchHistoryEntry(entry.TitleId, chosenAt));
        }

        var preferences = ValidatePreferences(payload.Preferences, errors);

        // Nothing is returned unless everything passed: a partially accepted
        // document would drop a rating without telling anyone.
        return errors.Count > 0
            ? ValidationOutcome<AccountState>.Invalid(errors)
            : ValidationOutcome<AccountState>.Valid(new AccountState(interactions, history, preferences));
    }

    private static readonly IReadOnlyDictionary<string, InteractionPayload> EmptyInteractions =
        new Dictionary<string, InteractionPayload>();

    /// <summary>
    /// Parses an ISO-8601 timestamp, assuming UTC when the string carries no
    /// offset.
    ///
    /// This is the determinism requirement, not a nicety: without
    /// <see cref="DateTimeStyles.AssumeUniversal"/>, a bare
    /// <c>2026-09-27T10:00:00</c> would be read as *this server's* local time,
    /// so the same payload would merge differently depending on where the API
    /// happens to run (constitution VI).
    /// </summary>
    private static bool TryParseTimestamp(string? text, out DateTimeOffset value)
    {
        return DateTimeOffset.TryParse(
            text,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out value);
    }

    private static PreferenceRecord? ValidatePreferences(PreferencePayload? payload, List<string> errors)
    {
        if (payload is null)
        {
            return null;
        }

        if (!TryParseTimestamp(payload.UpdatedAt, out var updatedAt))
        {
            errors.Add($"Preferences have an unreadable updatedAt '{payload.UpdatedAt}'.");
            return null;
        }

        if (!TryParseTimestamp(payload.CompletedAt, out var completedAt))
        {
            errors.Add($"Preferences have an unreadable completedAt '{payload.CompletedAt}'.");
            return null;
        }

        return new PreferenceRecord(
            ToChoice(payload.MediaType),
            ToChoice(payload.Genre),
            ToChoice(payload.Provider),
            payload.IncludeUnownedProviders,
            completedAt,
            updatedAt);
    }

    /// <summary>
    /// A missing dimension is "Any" rather than a rejection — the 001 contract
    /// already treats an absent choice as no preference, and a quiz document
    /// written before a dimension existed must not become unreadable.
    /// </summary>
    private static DimensionChoice ToChoice(DimensionChoicePayload? payload)
    {
        return payload is null
            ? DimensionChoice.NoPreference
            : new DimensionChoice(payload.Values ?? [], payload.Any);
    }
}

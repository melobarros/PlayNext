using Microsoft.EntityFrameworkCore;
using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The account store, on EF Core over PostgreSQL (research D3).
///
/// This class is deliberately thin. It loads rows, hands them to
/// <see cref="MergeService"/>, and writes back what changed — it does not decide
/// anything. The migration rule is the domain's, and restating any part of it
/// here (as a cleverer upsert, say) would create a second place for it to be
/// right or wrong.
/// </summary>
public sealed class AccountStateRepository(AppDbContext db) : IAccountStateRepository
{
    public async Task<AccountState> GetAsync(Guid userId, CancellationToken cancellationToken)
    {
        return Compose(
            await LoadInteractionsAsync(userId, forWrite: false, cancellationToken),
            await LoadHistoryAsync(userId, cancellationToken),
            await LoadPreferenceAsync(userId, forWrite: false, cancellationToken));
    }

    /// <summary>
    /// Read-merge-write inside one transaction (FR-007).
    ///
    /// The transaction is the whole of the interruption story: if the request
    /// dies mid-write, the account is left exactly as it was, the device's
    /// document is still the only copy of that data, and re-sending it is safe.
    ///
    /// Two devices merging for the same account at the same instant is a
    /// narrower case than that, and is <b>not</b> covered here — the default
    /// read-committed isolation lets both read the same starting state, so the
    /// later write can be based on a stale read. Serializing it would mean
    /// either a lock the spec did not ask for or a retry loop this file has no
    /// place to own; see the note in the PR description.
    /// </summary>
    public async Task<AccountState> MergeIntoAccountAsync(
        Guid userId,
        AccountState incoming,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var storedInteractions = await LoadInteractionsAsync(userId, forWrite: true, cancellationToken);
        var storedHistory = await LoadHistoryAsync(userId, cancellationToken);
        var storedPreference = await LoadPreferenceAsync(userId, forWrite: true, cancellationToken);

        var merged = MergeService.Merge(
            Compose(storedInteractions, storedHistory, storedPreference),
            incoming);

        ApplyInteractions(userId, storedInteractions, merged);
        ApplyHistory(userId, storedHistory, merged);
        ApplyPreferences(userId, storedPreference, merged);

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return merged;
    }

    /// <summary>
    /// Loads the account's ratings, tracked when the caller means to write them
    /// back.
    ///
    /// <paramref name="forWrite"/> is not a performance knob. It is the
    /// difference between a write and an assignment EF never hears about: the
    /// apply steps below change the rows they are handed, and a row loaded with
    /// <c>AsNoTracking</c> is not in the change tracker, so mutating it saves
    /// nothing at all. The failure is silent — the merge result the caller
    /// returns is correct either way — which is why it is decided here, at the
    /// one place that knows whether a write follows, rather than left to each
    /// mutation site to remember.
    /// </summary>
    private Task<List<UserInteraction>> LoadInteractionsAsync(
        Guid userId,
        bool forWrite,
        CancellationToken cancellationToken)
    {
        var query = db.Interactions.Where(interaction => interaction.UserId == userId);

        return (forWrite ? query : query.AsNoTracking()).ToListAsync(cancellationToken);
    }

    /// <summary>
    /// The watching log, always untracked: it is append-only, so the apply step
    /// inserts and never mutates a loaded row (<see cref="ApplyHistory"/>).
    /// </summary>
    private Task<List<UserWatchHistoryEntry>> LoadHistoryAsync(Guid userId, CancellationToken cancellationToken)
    {
        return db.WatchHistory
            .AsNoTracking()
            .Where(entry => entry.UserId == userId)
            .ToListAsync(cancellationToken);
    }

    /// <summary>Tracked for the same reason as <see cref="LoadInteractionsAsync"/>: the merge can replace the stored quiz (research D4).</summary>
    private Task<UserPreference?> LoadPreferenceAsync(
        Guid userId,
        bool forWrite,
        CancellationToken cancellationToken)
    {
        var query = db.Preferences.Where(preference => preference.UserId == userId);

        return (forWrite ? query : query.AsNoTracking()).FirstOrDefaultAsync(cancellationToken);
    }

    private static AccountState Compose(
        IReadOnlyList<UserInteraction> interactions,
        IReadOnlyList<UserWatchHistoryEntry> history,
        UserPreference? preferences)
    {
        return new AccountState(
            interactions.ToDictionary(
                interaction => interaction.TitleId,
                interaction => new InteractionRecord(interaction.State, interaction.UpdatedAt),
                StringComparer.Ordinal),
            [.. history.Select(entry => new WatchHistoryEntry(entry.TitleId, entry.ChosenAt))],
            preferences is null
                ? null
                : new PreferenceRecord(
                    preferences.MediaType,
                    preferences.Genre,
                    preferences.Provider,
                    preferences.IncludeUnownedProviders,
                    preferences.CompletedAt,
                    preferences.UpdatedAt));
    }

    /// <summary>
    /// Writes the ratings the merge changed: inserted, replaced, or dropped.
    ///
    /// The result is a union, so a title the account already had is still in
    /// <paramref name="merged"/> and a title only the account had cannot be
    /// missing from it. The one way a stored rating leaves is a removal that
    /// outranks it (FR-006), which is why this is the only collection here with
    /// a delete branch.
    /// </summary>
    private void ApplyInteractions(Guid userId, IReadOnlyList<UserInteraction> stored, AccountState merged)
    {
        var byTitle = stored.ToDictionary(interaction => interaction.TitleId, StringComparer.Ordinal);

        foreach (var (titleId, record) in merged.Interactions)
        {
            if (!byTitle.TryGetValue(titleId, out var row))
            {
                db.Interactions.Add(new UserInteraction
                {
                    UserId = userId,
                    TitleId = titleId,
                    State = record.State,
                    UpdatedAt = record.UpdatedAt,
                });

                continue;
            }

            if (row.State != record.State || row.UpdatedAt != record.UpdatedAt)
            {
                row.State = record.State;
                row.UpdatedAt = record.UpdatedAt;
            }
        }

        // Rows are found by diffing rather than by reading `merged.Removals`:
        // the merge has already applied them, so what survives is an absence,
        // and an absence is only visible by comparison.
        foreach (var stale in stored.Where(row => !merged.Interactions.ContainsKey(row.TitleId)))
        {
            db.Interactions.Remove(stale);
        }
    }

    /// <summary>
    /// Inserts the entries the account did not already have — and only those.
    ///
    /// The guard is applied here rather than left to the unique index: a
    /// rejected insert would fail the whole <c>SaveChanges</c> and roll back a
    /// migration that was otherwise fine, which is a harsh way to treat a
    /// retry. Append-only: unlike the ratings an entry is never replaced or
    /// withdrawn, so this method only ever inserts.
    /// </summary>
    private void ApplyHistory(Guid userId, IReadOnlyList<UserWatchHistoryEntry> stored, AccountState merged)
    {
        var seen = stored
            .Select(entry => (entry.TitleId, entry.ChosenAt))
            .ToHashSet();

        foreach (var entry in merged.History)
        {
            if (!seen.Add((entry.TitleId, entry.ChosenAt)))
            {
                continue;
            }

            db.WatchHistory.Add(new UserWatchHistoryEntry
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                TitleId = entry.TitleId,
                ChosenAt = entry.ChosenAt,
            });
        }
    }

    /// <summary>
    /// Writes the preferences document whole, and only when it differs. Never
    /// merges fields: the quiz is one set of choices, and a field-by-field write
    /// could produce a combination the visitor never chose (research D4).
    /// </summary>
    private void ApplyPreferences(Guid userId, UserPreference? stored, AccountState merged)
    {
        if (merged.Preferences is not { } preferences)
        {
            return;
        }

        if (stored is null)
        {
            db.Preferences.Add(new UserPreference
            {
                UserId = userId,
                MediaType = preferences.MediaType,
                Genre = preferences.Genre,
                Provider = preferences.Provider,
                IncludeUnownedProviders = preferences.IncludeUnownedProviders,
                CompletedAt = preferences.CompletedAt,
                UpdatedAt = preferences.UpdatedAt,
            });

            return;
        }

        if (Matches(stored, preferences))
        {
            return;
        }

        stored.MediaType = preferences.MediaType;
        stored.Genre = preferences.Genre;
        stored.Provider = preferences.Provider;
        stored.IncludeUnownedProviders = preferences.IncludeUnownedProviders;
        stored.CompletedAt = preferences.CompletedAt;
        stored.UpdatedAt = preferences.UpdatedAt;
    }

    private static bool Matches(UserPreference stored, PreferenceRecord preferences)
    {
        return SameChoice(stored.MediaType, preferences.MediaType)
            && SameChoice(stored.Genre, preferences.Genre)
            && SameChoice(stored.Provider, preferences.Provider)
            && stored.IncludeUnownedProviders == preferences.IncludeUnownedProviders
            && stored.CompletedAt == preferences.CompletedAt
            && stored.UpdatedAt == preferences.UpdatedAt;
    }

    /// <summary>
    /// Compares two choices by value.
    ///
    /// Spelled out because <see cref="DimensionChoice"/> is a record whose
    /// <c>Values</c> is a list, so the compiler-generated equality compares that
    /// list by reference — two equal choices read from different places would
    /// compare unequal, and this method is only ever asked "did anything
    /// change?".
    /// </summary>
    private static bool SameChoice(DimensionChoice left, DimensionChoice right)
    {
        return left.Any == right.Any
            && left.Values.SequenceEqual(right.Values, StringComparer.Ordinal);
    }
}

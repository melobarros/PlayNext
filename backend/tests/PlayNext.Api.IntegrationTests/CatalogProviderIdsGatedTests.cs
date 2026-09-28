using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using PlayNext.Domain;
using PlayNext.Infrastructure.Catalog;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Checks the seeded provider table against the provider itself (T025,
/// research D7).
///
/// <see cref="CatalogVocabulary.Providers"/> is a hand-written contract: a
/// number TMDB assigns, a name, and the search URL for that service. Everything
/// the catalog produces depends on those numbers still meaning what they meant
/// when they were written down — and nothing else in the suite can tell,
/// because every other catalog test answers from a stub built from the same
/// table. A stub cannot disagree with the thing it was copied from.
///
/// So this is the one test that asks the real API the only question that
/// matters: is the service at id 531 still Paramount Plus? If it is not, every
/// badge in every snapshot points at the wrong service, the visitor taps
/// through to somewhere that does not carry the title, and the app is
/// confidently wrong — the worst failure mode the constitution names. The fix
/// is a one-row edit in the seed table, reviewed in one pull request, which is
/// why the table is written out literally rather than derived.
///
/// Gated, because it is the only test here that needs a credential and a
/// network: without a key it skips rather than reporting red for a prerequisite
/// the machine simply does not have (the same rule as <c>GatedFactAttribute</c>
/// and PostgreSQL).
/// </summary>
public sealed class CatalogProviderIdsGatedTests
{
    /// <summary>
    /// The services the quiz offers, by the provider's own ids.
    ///
    /// These are the fatal ones when they go missing. A service the quiz offers
    /// but the catalog cannot badge is a filter that matches nothing: the
    /// visitor picks Peacock, the deck comes back empty, and nothing explains
    /// why (FR-006, FR-007). A service outside the quiz going missing costs a
    /// badge and no more, so an absent id is only reported for these.
    ///
    /// Only the numbers are repeated here — the names come from the seed table,
    /// so this list cannot drift into a second, disagreeing copy of it.
    ///
    /// **Eleven, not twelve.** This list was the thing that found Star+ (619)
    /// missing on 2026-09-28, and it found Max's id had moved from 384 to 1899
    /// in the same run. Both are corrected in the seed table; Star+ cannot be,
    /// because there is no longer a service to point at. Dropping 619 here is
    /// what records that the gap is known rather than making the test pass —
    /// id 384 is deliberately *replaced* by 1899 rather than deleted, so a
    /// future move of Max's id would still be caught.
    /// </summary>
    private static readonly int[] QuizServiceIds = [8, 119, 337, 1899, 350, 531, 283, 11, 307, 15, 386];

    [TmdbGatedFact]
    public async Task Every_seeded_id_still_names_the_service_it_was_seeded_for()
    {
        var live = await LiveProviderNamesAsync();

        var drift = new List<string>();

        foreach (var seeded in CatalogVocabulary.Providers)
        {
            if (!live.TryGetValue(seeded.TmdbId, out var liveName))
            {
                if (QuizServiceIds.Contains(seeded.TmdbId))
                {
                    drift.Add($"id {seeded.TmdbId} ({seeded.DisplayName}) is not listed at all any more");
                }

                // An id the provider does not list cannot be checked for naming,
                // and its absence is not drift for a service the quiz never
                // offered: the row simply stops matching. The regional tiers the
                // table carries a second id for are exactly this case — they are
                // listed against a region, not in the global vocabulary.
                continue;
            }

            if (!SameService(liveName, seeded.DisplayName))
            {
                drift.Add($"id {seeded.TmdbId} is \"{liveName}\" upstream, seeded as \"{seeded.DisplayName}\"");
            }
        }

        Assert.Empty(drift);
    }

    /// <summary>
    /// Every provider the API lists for both media types, by id.
    ///
    /// Both, and unioned: the seed table is not per-media-type, so an id is only
    /// unlisted if neither list carries it.
    /// </summary>
    private static async Task<Dictionary<int, string>> LiveProviderNamesAsync()
    {
        using var http = new HttpClient { BaseAddress = new TmdbOptions().BaseAddress };

        // The same way the client authenticates (research D1). Reading it from
        // the options object rather than restating the scheme keeps the two in
        // step — a change to how the credential is presented upstream is a
        // change in one place.
        http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", TmdbCredential.ApiKey!);

        var names = new Dictionary<int, string>();

        foreach (var mediaType in new[] { "movie", "tv" })
        {
            using var response = await http.GetAsync($"watch/providers/{mediaType}");

            response.EnsureSuccessStatusCode();

            var payload = await response.Content.ReadFromJsonAsync<JsonObject>();
            var results = payload?["results"]?.AsArray() ?? new JsonArray();

            foreach (var entry in results)
            {
                if (entry?["provider_id"]?.GetValue<int>() is { } id
                    && entry["provider_name"]?.GetValue<string>() is { } name)
                {
                    names[id] = name;
                }
            }
        }

        return names;
    }

    /// <summary>
    /// Whether two names are two names for the same service.
    ///
    /// Deliberately loose about spelling and deliberate about identity. The
    /// provider renames things without renaming the service — "Apple TV+" for
    /// "Apple TV Plus", "Amazon Prime Video" for "Prime Video" — and a test
    /// that insisted on the exact string would fail on a rename that harms
    /// nobody, which is how a useful check gets deleted. Comparing the letters
    /// and digits, ignoring case, and accepting a name that contains the other,
    /// survives every rename of that kind and still catches the failure that
    /// matters: an id that now belongs to a different service altogether.
    /// </summary>
    private static bool SameService(string live, string seeded)
    {
        var liveKey = Normalize(live);
        var seededKey = Normalize(seeded);

        return liveKey.Length > 0
            && seededKey.Length > 0
            && (liveKey.Contains(seededKey, StringComparison.Ordinal)
                || seededKey.Contains(liveKey, StringComparison.Ordinal));
    }

    /// <summary>A name reduced to the letters and digits it spells, lowercased.</summary>
    private static string Normalize(string name) =>
        new(name.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
}

/// <summary>
/// A <see cref="FactAttribute"/> that skips itself unless a real TMDB
/// credential is configured, so the suite still runs green on a machine without
/// one rather than reporting red for an absent prerequisite.
/// </summary>
public sealed class TmdbGatedFactAttribute : FactAttribute
{
    public TmdbGatedFactAttribute()
    {
        if (!TmdbCredential.IsConfigured)
        {
            Skip = TmdbCredential.SkipReason;
        }
    }
}

/// <summary>
/// The live TMDB credential, located the way the API locates it: user-secrets
/// (quickstart.md). A test that forged its own key would pass while the
/// application could not authenticate at all.
///
/// **User-secrets only, and never the environment.** The catalog suite's factory
/// sets <c>Tmdb__ApiKey</c> to a placeholder so the host will start without a
/// real credential, and it does so for the whole test process — so a gate that
/// also read the environment would find that placeholder, decide it had a key,
/// and send it to the real API. Reading only the store the application reads
/// keeps "configured" meaning what it says.
/// </summary>
internal static class TmdbCredential
{
    public const string SkipReason =
        "Needs a live TMDB credential: set Tmdb:ApiKey in PlayNext.Api's user-secrets (see specs/005-tmdb-catalog/quickstart.md).";

    public static string? ApiKey { get; } = Resolve();

    public static bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    private static string? Resolve() =>
        new ConfigurationBuilder()
            .AddUserSecrets(typeof(Program).Assembly, optional: true)
            .Build()["Tmdb:ApiKey"];
}

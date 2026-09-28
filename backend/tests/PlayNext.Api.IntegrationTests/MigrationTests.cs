using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Gated integration tests for the guest→account migration (US3) — the
/// feature's named critical path, and the one the constitution requires to be
/// written test-first.
///
/// <see cref="AuthTests"/> already covers the cases either side of a conflict
/// one at a time. What this file adds is the scenario as the spec states it,
/// and in particular the half of "newer wins" that is easy to leave out: the
/// side that must <em>lose</em>. A merge that always took the incoming rating
/// answers every case AuthTests exercises correctly — a device's newer rating
/// really should win, and a title only it knows about really should appear —
/// while quietly overwriting the account's newer work from any device that has
/// been offline for a while. The reverse direction is the only thing that
/// catches it, so it is here twice: once for ratings and once for the quiz.
///
/// <para>
/// Every assertion about what the account holds is made from a <b>later
/// session</b>, through <c>GET /me/state</c>. Never from the merging call's own
/// response: the merge is computed in memory, so that response is byte-identical
/// whether or not the write reached PostgreSQL. It is a convincing read and not
/// a read at all, which is how a lost update stays invisible.
/// </para>
/// </summary>
public sealed class MigrationTests : IClassFixture<AuthApiFactory>
{
    private readonly AuthApiFactory _api;

    public MigrationTests(AuthApiFactory api) => _api = api;

    private const string Password = "Correct-Horse-9!";

    /// <summary>A fresh address per test, so tests do not depend on each other's rows.</summary>
    private static string NewEmail() => $"visitor-{Guid.NewGuid():N}@example.com";

    private static JsonObject Rating(string state, string updatedAt) =>
        new() { ["state"] = state, ["updatedAt"] = updatedAt };

    private static JsonObject Watched(string titleId, string chosenAt) =>
        new() { ["titleId"] = titleId, ["chosenAt"] = chosenAt };

    /// <summary>
    /// Two dimensions rather than one, so a document that was field-merged
    /// instead of replaced has somewhere to show it.
    /// </summary>
    private static JsonObject Quiz(string mediaType, string genre, string updatedAt)
    {
        return new JsonObject
        {
            ["mediaType"] = new JsonObject { ["values"] = new JsonArray(mediaType), ["any"] = false },
            ["genre"] = new JsonObject { ["values"] = new JsonArray(genre), ["any"] = false },
            ["provider"] = new JsonObject { ["values"] = new JsonArray(), ["any"] = true },
            ["includeUnownedProviders"] = false,
            ["completedAt"] = updatedAt,
            ["updatedAt"] = updatedAt,
        };
    }

    /// <summary>Registers an account carrying the given guest document, and returns its address.</summary>
    private async Task<string> RegisteredAsync(JsonObject guest)
    {
        var email = NewEmail();

        var response = await _api.CreateClient().PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = Password,
            ["guest"] = guest,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        return email;
    }

    /// <summary>Signs a device in, carrying whatever that device had.</summary>
    private async Task SignInAsync(string email, JsonObject guest)
    {
        var response = await _api.CreateClient().PostAsJsonAsync("/api/auth/login", new JsonObject
        {
            ["email"] = email,
            ["password"] = Password,
            ["guest"] = guest,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// What the account actually holds.
    ///
    /// A later session on a device with nothing of its own to merge, reading
    /// through <c>GET /me/state</c> — the endpoint with no merge in it at all.
    /// The login is only there to obtain the token, which is why the read is a
    /// separate call rather than the login's own response.
    /// </summary>
    private async Task<JsonObject> StoredAsync(string email)
    {
        var login = await _api.CreateClient().PostAsJsonAsync("/api/auth/login", new JsonObject
        {
            ["email"] = email,
            ["password"] = Password,
        });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var token = JsonNode.Parse(await login.Content.ReadAsStringAsync())!
            ["accessToken"]!.GetValue<string>();

        var client = _api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/me/state");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
    }

    private static string StateOf(JsonObject state, string titleId) =>
        state["interactions"]![titleId]!["state"]!.GetValue<string>();

    [GatedFact]
    public async Task Titles_unique_to_either_side_all_survive_the_merge()
    {
        // US3 scenario 1: "titles unique to either side all appear in the merged
        // account". Both migration paths at once, because the checkpoint's claim
        // is that they are both lossless and they share `CompleteAsync`.
        var email = await RegisteredAsync(new JsonObject
        {
            ["interactions"] = new JsonObject { ["arrival"] = Rating("loved", "2026-09-27T10:00:00Z") },
            ["history"] = new JsonArray { Watched("arrival", "2026-09-27T10:05:00Z") },
        });

        // A second device, carrying a title the account has never seen.
        await SignInAsync(email, new JsonObject
        {
            ["interactions"] = new JsonObject { ["dune"] = Rating("wantToWatch", "2026-09-27T11:00:00Z") },
            ["history"] = new JsonArray { Watched("dune", "2026-09-27T11:05:00Z") },
        });

        var stored = await StoredAsync(email);

        // The exact set, not "contains both". A list would also pass if the
        // merge had invented a third title, or dropped one and added another.
        Assert.Equal(
            new[] { "arrival", "dune" },
            stored["interactions"]!.AsObject().Select(entry => entry.Key).Order().ToList());

        // And the values, not only the keys: a union that kept both ids while
        // giving them one side's state would satisfy a count.
        Assert.Equal("loved", StateOf(stored, "arrival"));
        Assert.Equal("wantToWatch", StateOf(stored, "dune"));

        Assert.Equal(
            new[] { "arrival", "dune" },
            stored["history"]!.AsArray()
                .Select(entry => entry!["titleId"]!.GetValue<string>())
                .Order()
                .ToList());
    }

    [GatedFact]
    public async Task A_replayed_guest_document_does_not_duplicate_the_watching_log()
    {
        // FR-007. An interrupted sign-in retried is the same document going up
        // twice, and the watching log is the collection where a retry does
        // visible damage: `(titleId, chosenAt)` is its identity, so a second
        // row is a second watch that never happened. Worth asserting against
        // PostgreSQL rather than against the merge rule, because only the
        // database can be handed the same insert twice.
        var email = await RegisteredAsync(new JsonObject
        {
            ["history"] = new JsonArray { Watched("arrival", "2026-09-27T10:05:00Z") },
        });

        await SignInAsync(email, new JsonObject
        {
            ["history"] = new JsonArray { Watched("arrival", "2026-09-27T10:05:00Z") },
        });

        var stored = await StoredAsync(email);

        Assert.Single(stored["history"]!.AsArray());
    }

    [GatedFact]
    public async Task An_older_rating_from_a_device_does_not_overwrite_the_accounts_newer_one()
    {
        // US3 scenario 2: "the newer rating wins ... on every device". This is
        // the direction that is easy to leave untested and the only one that
        // catches a merge which always prefers whatever arrived.
        var email = await RegisteredAsync(new JsonObject
        {
            ["interactions"] = new JsonObject { ["arrival"] = Rating("loved", "2026-09-27T10:05:00Z") },
        });

        // A device that has been offline since before the visitor changed their
        // mind elsewhere.
        await SignInAsync(email, new JsonObject
        {
            ["interactions"] = new JsonObject { ["arrival"] = Rating("disliked", "2026-09-27T10:00:00Z") },
        });

        var stored = await StoredAsync(email);

        Assert.Equal("loved", StateOf(stored, "arrival"));

        // The timestamp travels with the winning record, and that is not
        // decoration: it is the value the next conflict is settled against, so a
        // merge that kept the state and took the losing device's clock would
        // hand the title back on the visitor's next sign-in.
        Assert.Equal(
            DateTimeOffset.Parse("2026-09-27T10:05:00Z", CultureInfo.InvariantCulture),
            stored["interactions"]!["arrival"]!["updatedAt"]!.GetValue<DateTimeOffset>());
    }

    [GatedFact]
    public async Task An_older_quiz_from_a_device_does_not_replace_the_accounts_newer_one()
    {
        // US3 scenario 3, the same direction as the rating above. Preferences
        // are the quieter failure of the two — a stale quiz is still a
        // well-formed document, so every reader downstream is satisfied and
        // nobody notices the deck is ranking against last month's answers.
        var email = await RegisteredAsync(new JsonObject
        {
            ["preferences"] = Quiz("tv", "horror", "2026-09-27T09:30:00Z"),
        });

        await SignInAsync(email, new JsonObject
        {
            ["preferences"] = Quiz("movie", "sci-fi", "2026-09-27T09:00:00Z"),
        });

        var stored = await StoredAsync(email);
        var preferences = stored["preferences"]!;

        // Both dimensions, because the rule is that preferences are replaced
        // whole (research D4) rather than merged field by field. Asserting one
        // field would pass on a field-merge that produced a quiz neither the
        // visitor nor their account ever answered.
        Assert.Equal("tv", preferences["mediaType"]!["values"]![0]!.GetValue<string>());
        Assert.Equal("horror", preferences["genre"]!["values"]![0]!.GetValue<string>());

        Assert.Equal(
            DateTimeOffset.Parse("2026-09-27T09:30:00Z", CultureInfo.InvariantCulture),
            preferences["updatedAt"]!.GetValue<DateTimeOffset>());
    }
}

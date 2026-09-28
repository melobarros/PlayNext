using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Gated integration tests for the state endpoints (T032), driving the real
/// stack in-process like <see cref="AuthTests"/>.
///
/// These exist because the repository has behaviours no fake can settle. The
/// removal path is the clearest: it is the one place a merge result can hold
/// *fewer* ratings than the account already had, and "the row is gone" is a
/// claim about PostgreSQL, not about an object graph. A fake that stored the
/// merged state would have agreed with a delete path that never ran.
///
/// Every assertion here reads back through <c>GET /me/state</c> rather than
/// trusting the sync response. The response is computed in memory, so it is
/// identical whether or not the write landed — which is exactly how a lost
/// update stayed invisible until it was looked for.
/// </summary>
public sealed class StateTests : IClassFixture<AuthApiFactory>
{
    private readonly AuthApiFactory _api;

    public StateTests(AuthApiFactory api) => _api = api;

    private static string NewEmail() => $"visitor-{Guid.NewGuid():N}@example.com";

    /// <summary>Registers an account carrying the given guest document, and returns a client holding its token.</summary>
    private async Task<HttpClient> SignedInAsync(JsonObject guest)
    {
        var response = await _api.CreateClient().PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = NewEmail(),
            ["password"] = "Correct-Horse-9!",
            ["guest"] = guest,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var token = JsonNode.Parse(await response.Content.ReadAsStringAsync())!
            ["accessToken"]!.GetValue<string>();

        var client = _api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return client;
    }

    private static JsonObject Rating(string state, string updatedAt) =>
        new() { ["state"] = state, ["updatedAt"] = updatedAt };

    private static async Task<JsonObject> Interactions(HttpClient client)
    {
        var response = await client.GetAsync("/api/me/state");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!["interactions"]!.AsObject();
    }

    [GatedFact]
    public async Task A_removal_newer_than_the_stored_rating_deletes_it_and_leaves_the_rest_alone()
    {
        // FR-006 through the whole stack. The second title is what makes this a
        // test rather than a coincidence: an account that came back empty would
        // satisfy "the removed title is gone" while having lost everything.
        var client = await SignedInAsync(new JsonObject
        {
            ["interactions"] = new JsonObject
            {
                ["hereditary"] = Rating("disliked", "2026-09-27T10:00:00Z"),
                ["arrival"] = Rating("loved", "2026-09-27T10:00:00Z"),
            },
        });

        var synced = await client.PostAsJsonAsync("/api/me/sync", new JsonObject
        {
            ["removals"] = new JsonArray
            {
                new JsonObject { ["titleId"] = "hereditary", ["updatedAt"] = "2026-09-27T10:05:00Z" },
            },
        });

        Assert.Equal(HttpStatusCode.OK, synced.StatusCode);

        // Read back from the database, not from the merge the response carries.
        var stored = await Interactions(client);

        Assert.Equal(["arrival"], stored.Select(entry => entry.Key).Order().ToList());
    }

    [GatedFact]
    public async Task An_older_removal_loses_to_the_stored_rating()
    {
        // A replayed queue must not unrate a title the visitor re-rated
        // afterwards — the same newest-wins rule as everything else, so a stale
        // removal sitting in a queue is harmless rather than destructive.
        var client = await SignedInAsync(new JsonObject
        {
            ["interactions"] = new JsonObject
            {
                ["hereditary"] = Rating("disliked", "2026-09-27T10:05:00Z"),
            },
        });

        await client.PostAsJsonAsync("/api/me/sync", new JsonObject
        {
            ["removals"] = new JsonArray
            {
                new JsonObject { ["titleId"] = "hereditary", ["updatedAt"] = "2026-09-27T10:00:00Z" },
            },
        });

        Assert.Equal(["hereditary"], (await Interactions(client)).Select(entry => entry.Key).ToList());
    }

    [GatedFact]
    public async Task A_body_naming_one_title_leaves_the_other_collections_untouched()
    {
        // The partial-body rule against a real database. An implementation that
        // read an absent collection as "empty this out" would answer 200 while
        // deleting the watching log and the quiz.
        var client = await SignedInAsync(new JsonObject
        {
            ["interactions"] = new JsonObject { ["arrival"] = Rating("loved", "2026-09-27T10:00:00Z") },
            ["history"] = new JsonArray
            {
                new JsonObject { ["titleId"] = "arrival", ["chosenAt"] = "2026-09-27T10:05:00Z" },
            },
            ["preferences"] = new JsonObject
            {
                ["mediaType"] = new JsonObject { ["values"] = new JsonArray("movie"), ["any"] = false },
                ["genre"] = new JsonObject { ["values"] = new JsonArray("sci-fi"), ["any"] = false },
                ["provider"] = new JsonObject { ["values"] = new JsonArray(), ["any"] = true },
                ["includeUnownedProviders"] = false,
                ["completedAt"] = "2026-09-27T09:00:00Z",
                ["updatedAt"] = "2026-09-27T09:00:00Z",
            },
        });

        await client.PostAsJsonAsync("/api/me/sync", new JsonObject
        {
            ["interactions"] = new JsonObject { ["dune"] = Rating("wantToWatch", "2026-09-27T11:00:00Z") },
        });

        var response = await client.GetAsync("/api/me/state");
        var state = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

        Assert.Equal(2, state["interactions"]!.AsObject().Count);
        Assert.Single(state["history"]!.AsArray());
        Assert.NotNull(state["preferences"]);
    }

    [GatedFact]
    public async Task The_state_endpoints_refuse_a_request_with_no_token()
    {
        // The bearer requirement is the only thing standing between one
        // visitor's account and another's, so it is asserted rather than
        // assumed from the attribute that declares it.
        Assert.Equal(HttpStatusCode.Unauthorized, (await _api.CreateClient().GetAsync("/api/me/state")).StatusCode);

        var sync = await _api.CreateClient().PostAsJsonAsync("/api/me/sync", new JsonObject());

        Assert.Equal(HttpStatusCode.Unauthorized, sync.StatusCode);
    }
}

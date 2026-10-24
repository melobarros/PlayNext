using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Gated integration tests for the recommendation-event intake (T022), driving
/// the real host the way <see cref="StateTests"/> does.
///
/// The application suite settles the validator, the limiter and the ordering
/// between them. What only a real stack can show is the part the record is
/// worth anything for: that a guest can post without an account and still get
/// a row, that a retried flush really inserts nothing the second time (the
/// unique index is doing that, not the client's good manners), that an action
/// really lands on the impression it names, and that the table really holds no
/// field that could identify a person.
///
/// Every test writes under its own random session id, so the shared test
/// database needs no cleanup between them — the id is both the partition and
/// the key the assertions count by.
/// </summary>
public sealed class RecommendationEventTests : IClassFixture<AuthApiFactory>
{
    private const string Endpoint = "/api/recommendations/events";

    private const string ShownAt = "2026-10-24T18:00:00.000Z";

    private const string OccurredAt = "2026-10-24T18:00:02.400Z";

    private const string CatalogVersion = "2026-10-24T17:07:32.000Z";

    private readonly AuthApiFactory _api;

    public RecommendationEventTests(AuthApiFactory api) => _api = api;

    /// <summary>A session id no other test has used, which is also its row filter.</summary>
    private static string NewSession() => Guid.NewGuid().ToString();

    private static DbContextOptions<AppDbContext> DbOptions() =>
        new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(Postgres.ConnectionString)
            .Options;

    private static JsonObject Impression(
        string sessionId,
        Guid clientEventId,
        string titleId = "arrival",
        int position = 1,
        string surface = "deck",
        string reasonCode = "none",
        string filterHash = "0123456789abcdef")
    {
        return new JsonObject
        {
            ["clientEventId"] = clientEventId,
            ["sessionId"] = sessionId,
            ["titleId"] = titleId,
            ["surface"] = surface,
            ["position"] = position,
            ["engineVersion"] = "recommend-v1",
            ["catalogVersion"] = CatalogVersion,
            ["filterHash"] = filterHash,
            ["score"] = 7.5,
            ["reasonCode"] = reasonCode,
            ["shownAt"] = ShownAt,
        };
    }

    private static JsonObject Action(
        Guid clientEventId,
        Guid impressionClientEventId,
        string kind = "liked",
        int dwellMs = 2400)
    {
        return new JsonObject
        {
            ["clientEventId"] = clientEventId,
            ["impressionClientEventId"] = impressionClientEventId,
            ["kind"] = kind,
            ["dwellMs"] = dwellMs,
            ["occurredAt"] = OccurredAt,
        };
    }

    private static JsonObject Batch(JsonArray? impressions = null, JsonArray? actions = null) =>
        new() { ["impressions"] = impressions ?? [], ["actions"] = actions ?? [] };

    private async Task<HttpResponseMessage> PostAsync(
        JsonObject body,
        string? bearer = null)
    {
        var client = _api.CreateClient();

        if (bearer is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }

        return await client.PostAsJsonAsync(Endpoint, body);
    }

    private static async Task<JsonObject> BodyOf(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

    private static async Task<int> ImpressionCountAsync(string sessionId)
    {
        await using var db = new AppDbContext(DbOptions());

        return await db.RecommendationImpressions.CountAsync(row => row.SessionId == sessionId);
    }

    private static async Task<int> ActionCountAsync(string sessionId)
    {
        await using var db = new AppDbContext(DbOptions());

        return await db.RecommendationActions.CountAsync(action =>
            db.RecommendationImpressions.Any(
                impression => impression.Id == action.ImpressionId && impression.SessionId == sessionId));
    }

    [GatedFact]
    public async Task A_guest_batch_is_accepted_and_linked()
    {
        // No account, no header, no cookie: the endpoint is anonymous by
        // design, and a guest's deck is the population this feature exists to
        // observe.
        var session = NewSession();
        var impressionId = Guid.NewGuid();
        var actionId = Guid.NewGuid();

        var response = await PostAsync(Batch(
            impressions: [Impression(session, impressionId)],
            actions: [Action(actionId, impressionId)]));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        var body = await BodyOf(response);

        Assert.Equal(1, body["accepted"]!["impressions"]!.GetValue<int>());
        Assert.Equal(1, body["accepted"]!["actions"]!.GetValue<int>());
        Assert.Equal(0, body["duplicates"]!.GetValue<int>());
        Assert.Equal(0, body["unlinked"]!.GetValue<int>());

        await using var db = new AppDbContext(DbOptions());

        var impression = await db.RecommendationImpressions
            .SingleAsync(row => row.ClientEventId == impressionId);

        Assert.Equal(session, impression.SessionId);
        Assert.Null(impression.UserId);
        Assert.Equal("arrival", impression.TitleId);
        Assert.Equal("deck", impression.Surface);
        Assert.Equal(1, impression.Position);
        Assert.Equal("recommend-v1", impression.EngineVersion);
        Assert.Equal(
            DateTimeOffset.Parse(CatalogVersion, System.Globalization.CultureInfo.InvariantCulture),
            impression.CatalogVersion);
        Assert.Equal("0123456789abcdef", impression.FilterHash);
        Assert.Equal(7.5, impression.Score);
        Assert.Equal("none", impression.ReasonCode);

        // The link is the server's, not the client's: the action row points at
        // the impression's identity, which the client never sees.
        var action = await db.RecommendationActions.SingleAsync(row => row.ClientEventId == actionId);

        Assert.Equal(impression.Id, action.ImpressionId);
        Assert.Equal("liked", action.Kind);
        Assert.Equal(2400, action.DwellMs);
    }

    [GatedFact]
    public async Task An_action_for_an_impression_that_does_not_exist_is_counted_unlinked_and_dropped()
    {
        // An action can outlive its impression in the client's queue — the
        // impression batch was lost, or the tab was closed between flushes. The
        // honest answer is to count it rather than invent a parent: a row
        // pointing at nothing would make every later join lie.
        var session = NewSession();
        var actionId = Guid.NewGuid();

        var response = await PostAsync(Batch(
            actions: [Action(actionId, Guid.NewGuid())]));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        var body = await BodyOf(response);

        Assert.Equal(1, body["unlinked"]!.GetValue<int>());
        Assert.Equal(0, body["accepted"]!["actions"]!.GetValue<int>());

        await using var db = new AppDbContext(DbOptions());

        Assert.False(await db.RecommendationActions.AnyAsync(row => row.ClientEventId == actionId));
    }

    [GatedFact]
    public async Task Submitting_the_same_batch_twice_stores_nothing_the_second_time()
    {
        // FR-008. The retry is exactly what a fire-and-forget client does when
        // it did not see the first 202, so idempotency cannot live in the
        // client's bookkeeping — it has to be the unique index, and this asserts
        // through the endpoint rather than by inserting rows by hand.
        var session = NewSession();
        var impressionId = Guid.NewGuid();
        var actionId = Guid.NewGuid();
        var batch = Batch(
            impressions: [Impression(session, impressionId)],
            actions: [Action(actionId, impressionId)]);

        var first = await PostAsync(batch);
        var second = await PostAsync(batch);

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);

        var body = await BodyOf(second);

        Assert.Equal(0, body["accepted"]!["impressions"]!.GetValue<int>());
        Assert.Equal(0, body["accepted"]!["actions"]!.GetValue<int>());
        Assert.Equal(2, body["duplicates"]!.GetValue<int>());
        Assert.Equal(0, body["unlinked"]!.GetValue<int>());

        Assert.Equal(1, await ImpressionCountAsync(session));
        Assert.Equal(1, await ActionCountAsync(session));
    }

    [GatedFact]
    public async Task A_retried_impression_still_resolves_a_new_action()
    {
        // The client may flush an impression twice and only then act on it. The
        // duplicate impression must not orphan the action that follows: the
        // second insert is skipped, and the action links to the row the first
        // attempt stored.
        var session = NewSession();
        var impressionId = Guid.NewGuid();
        var impression = Batch(impressions: [Impression(session, impressionId)]);

        await PostAsync(impression);
        var retried = await PostAsync(impression);

        Assert.Equal(1, (await BodyOf(retried))["duplicates"]!.GetValue<int>());

        var actionId = Guid.NewGuid();
        var acted = await PostAsync(Batch(actions: [Action(actionId, impressionId)]));

        Assert.Equal(1, (await BodyOf(acted))["accepted"]!["actions"]!.GetValue<int>());
    }

    [GatedFact]
    public async Task A_position_of_zero_is_refused_and_stores_nothing()
    {
        var session = NewSession();

        var response = await PostAsync(Batch(
            impressions: [Impression(session, Guid.NewGuid(), position: 0)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await BodyOf(response);

        Assert.Equal("invalid-payload", body["code"]!.GetValue<string>());
        Assert.Contains(
            body["errors"]!.AsArray(),
            error => error!.GetValue<string>().Contains("position", StringComparison.Ordinal));
        Assert.Equal(0, await ImpressionCountAsync(session));
    }

    [GatedFact]
    public async Task An_unknown_action_kind_is_refused_and_stores_nothing()
    {
        var session = NewSession();
        var impressionId = Guid.NewGuid();

        var response = await PostAsync(Batch(
            impressions: [Impression(session, impressionId)],
            actions: [Action(Guid.NewGuid(), impressionId, kind: "loved")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await ImpressionCountAsync(session));
        Assert.Equal(0, await ActionCountAsync(session));
    }

    [GatedFact]
    public async Task An_unknown_reason_code_is_refused_and_stores_nothing()
    {
        var session = NewSession();

        var response = await PostAsync(Batch(
            impressions: [Impression(session, Guid.NewGuid(), reasonCode: "free")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await ImpressionCountAsync(session));
    }

    [GatedFact]
    public async Task A_surface_other_than_the_deck_is_refused_and_stores_nothing()
    {
        // `deck` is the only surface that exists today. Accepting an invented
        // one would put a value in an append-only table that no later analysis
        // could interpret.
        var session = NewSession();

        var response = await PostAsync(Batch(
            impressions: [Impression(session, Guid.NewGuid(), surface: "watchlist")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await ImpressionCountAsync(session));
    }

    [GatedFact]
    public async Task A_batch_of_101_impressions_is_too_large()
    {
        // FR-009. 413 rather than 400: the body is well-formed and the request
        // is simply bigger than the protocol allows, which is a different thing
        // for the client to do about it — this one must not be retried as-is.
        var session = NewSession();

        var impressions = new JsonArray(
            [.. Enumerable.Range(0, 101).Select(_ => (JsonNode)Impression(session, Guid.NewGuid()))]);

        var response = await PostAsync(Batch(impressions: impressions));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);

        var body = await BodyOf(response);

        Assert.Equal("payload-too-large", body["code"]!.GetValue<string>());
        Assert.Equal(0, await ImpressionCountAsync(session));
    }

    [GatedFact]
    public async Task A_body_over_256_kilobytes_is_too_large_before_it_is_validated()
    {
        // The size check has to run first. A body this large is going to fail
        // validation too; answering 400 would tell the client to look at its
        // fields when the only thing wrong is the size, and would make the
        // server parse a quarter-megabyte to discover it.
        var session = NewSession();

        var response = await PostAsync(Batch(impressions:
            [Impression(session, Guid.NewGuid(), titleId: new string('a', 300 * 1024))]));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal(0, await ImpressionCountAsync(session));
    }

    [GatedFact]
    public async Task A_valid_bearer_stamps_the_account_on_the_impression()
    {
        // A signed-in visitor's events are attributable to the account; a
        // guest's are not. Neither is required, which is why the endpoint has
        // no RequireAuthorization.
        var registered = await _api.CreateClient().PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = $"visitor-{Guid.NewGuid():N}@example.com",
            ["password"] = "Correct-Horse-9!",
        });

        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);

        var registration = await BodyOf(registered);
        var userId = Guid.Parse(registration["userId"]!.GetValue<string>());
        var token = registration["accessToken"]!.GetValue<string>();

        var session = NewSession();
        var impressionId = Guid.NewGuid();

        var response = await PostAsync(Batch(impressions: [Impression(session, impressionId)]), token);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        await using var db = new AppDbContext(DbOptions());

        var impression = await db.RecommendationImpressions
            .SingleAsync(row => row.ClientEventId == impressionId);

        Assert.Equal(userId, impression.UserId);
    }

    [GatedFact]
    public async Task An_invalid_bearer_is_ignored_rather_than_refused()
    {
        // The endpoint is anonymous and stays anonymous when a stale token
        // arrives: refusing would mean a signed-out tab stops recording its own
        // deck, and the client has no way to make that visible to anyone.
        var session = NewSession();
        var impressionId = Guid.NewGuid();

        var response = await PostAsync(
            Batch(impressions: [Impression(session, impressionId)]),
            bearer: "not-a-real-token");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        await using var db = new AppDbContext(DbOptions());

        var impression = await db.RecommendationImpressions
            .SingleAsync(row => row.ClientEventId == impressionId);

        Assert.Null(impression.UserId);
    }

    [GatedFact]
    public async Task The_response_echoes_neither_a_token_nor_a_session()
    {
        // The response is counters and nothing else. Echoing the body back — a
        // plausible convenience for debugging — would put the session id in a
        // response the client logs, and could eventually put a token there too.
        var session = NewSession();

        var response = await PostAsync(Batch(impressions: [Impression(session, Guid.NewGuid())]));

        var raw = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(session, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("bearer", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("arrival", raw, StringComparison.OrdinalIgnoreCase);
    }

    [GatedFact]
    public async Task The_tables_hold_no_field_that_could_identify_a_person()
    {
        // FR-006 / FR-018, asserted against the schema rather than the code:
        // the guarantee is about what the database holds, and a field added by
        // a later migration would never pass through today's endpoint.
        await using var db = new AppDbContext(DbOptions());

        var columns = await db.Database
            .SqlQuery<string>($"""
                SELECT column_name AS "Value"
                FROM information_schema.columns
                WHERE table_name IN ('RecommendationImpressions', 'RecommendationActions')
                """)
            .ToListAsync();

        // The query found the tables. Without this a renamed table would make
        // every assertion below vacuous.
        Assert.Contains("SessionId", columns);
        Assert.Contains("ReasonCode", columns);
        Assert.Contains("ImpressionId", columns);

        string[] forbidden = ["name", "email", "password", "phone", "address", "agent", "ip", "location", "country"];

        foreach (var column in columns)
        {
            foreach (var fragment in forbidden)
            {
                Assert.False(
                    column.Contains(fragment, StringComparison.OrdinalIgnoreCase),
                    $"column '{column}' looks like it holds personal data ('{fragment}')");
            }
        }
    }

    [GatedFact]
    public async Task The_twenty_first_flush_in_a_minute_is_rate_limited()
    {
        // 429 with a Retry-After, and the header has to be present and a real
        // number: the transport backs off by that value, so a 429 without it
        // degrades into retry-immediately.
        var session = NewSession();

        for (var i = 0; i < 20; i++)
        {
            var admitted = await PostAsync(Batch(impressions: [Impression(session, Guid.NewGuid())]));

            Assert.Equal(HttpStatusCode.Accepted, admitted.StatusCode);
        }

        var refused = await PostAsync(Batch(impressions: [Impression(session, Guid.NewGuid())]));

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.NotNull(refused.Headers.RetryAfter);
        Assert.True(refused.Headers.RetryAfter!.Delta >= TimeSpan.FromSeconds(1));
        Assert.Equal(20, await ImpressionCountAsync(session));
    }
}

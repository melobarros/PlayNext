using System.Net;
using System.Text.Json.Nodes;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// The operator surface (T049, contracts/catalog-refresh.md).
///
/// The admin routes are a deployment decision, not a runtime one: without
/// <c>Catalog:AdminToken</c> they are never mapped, and the API answers the
/// ordinary 404 rather than advertising a feature it does not have. With a
/// token they are the one way a run is started outside the schedule, so the
/// suite holds every property an operator depends on: a wrong token is
/// refused before anything else, a parameter mistake is refused without
/// starting work, a second request while a run is in flight is a conflict
/// rather than a queue, and the status route reports the run's real shape from
/// "running" through to its terminal state.
///
/// The token is a credential even in the tests: no response body and no log
/// line may contain it (FR-017).
/// </summary>
[Collection("catalog")]
public sealed class Catalog_admin(CatalogApiFactory api) : NormalizedCatalogTest(api)
{
    private const string AdminHeader = "X-PlayNext-Admin-Token";

    /// <summary>A host built the way a deployment without the token is built.</summary>
    private sealed class NoAdminTokenFactory : CatalogApiFactory
    {
        public NoAdminTokenFactory()
        {
            // Read when the routes are mapped, which happens at host build —
            // after this constructor has run and before CreateClient.
            Settings["Catalog:AdminToken"] = null;
        }
    }

    private HttpClient AdminClient(string? token = null)
    {
        var client = _api.CreateClient();

        client.DefaultRequestHeaders.Add(
            AdminHeader,
            token ?? CatalogApiFactory.TestAdminToken);

        return client;
    }

    private static async Task<(HttpStatusCode Status, string Raw, JsonObject Body)> SendAsync(
        HttpClient client,
        HttpMethod method,
        string url)
    {
        using var request = new HttpRequestMessage(method, url);

        var response = await client.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync();

        return (response.StatusCode, raw, JsonNode.Parse(raw)!.AsObject());
    }

    /// <summary>Polls the status route until it reports the shape a step is waiting for.</summary>
    private static async Task<JsonObject> WaitForStatusAsync(
        HttpClient client,
        Func<JsonObject, bool> satisfied,
        string region = "BR")
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(15);

        while (true)
        {
            var (status, _, body) = await SendAsync(
                client,
                HttpMethod.Get,
                $"/api/catalog/refresh/status?region={region}");

            Assert.Equal(HttpStatusCode.OK, status);

            if (satisfied(body))
            {
                return body;
            }

            Assert.True(
                DateTimeOffset.UtcNow < deadline,
                $"the status route never reported the expected shape: {body}");

            await Task.Delay(25);
        }
    }

    [Fact]
    public async Task Operator_routes_do_not_exist_when_no_token_is_configured()
    {
        using var withoutAdmin = new NoAdminTokenFactory();
        using var client = withoutAdmin.CreateClient();

        // Not a 401: a deployment without a token does not have the feature,
        // and the route table is the only thing that can say so truthfully.
        var start = await client.PostAsync("/api/catalog/refresh?region=BR", null);

        Assert.Equal(HttpStatusCode.NotFound, start.StatusCode);

        var status = await client.GetAsync("/api/catalog/refresh/status?region=BR");

        Assert.Equal(HttpStatusCode.NotFound, status.StatusCode);
    }

    [Fact]
    public async Task Admin_requests_require_the_configured_token_and_validate_their_parameters()
    {
        await _api.ResetCatalogAsync();

        var anonymous = _api.CreateClient();

        var (missingStatus, missingRaw, missingBody) = await SendAsync(
            anonymous,
            HttpMethod.Post,
            "/api/catalog/refresh?region=BR");

        Assert.Equal(HttpStatusCode.Unauthorized, missingStatus);
        Assert.Equal("admin-unauthorized", missingBody["code"]!.GetValue<string>());

        const string WrongToken = "wrong-token-not-the-configured-one";

        var wrong = AdminClient(WrongToken);

        var (refusedStatus, refusedRaw, refusedBody) = await SendAsync(
            wrong,
            HttpMethod.Post,
            "/api/catalog/refresh?region=BR");

        Assert.Equal(HttpStatusCode.Unauthorized, refusedStatus);
        Assert.Equal("admin-unauthorized", refusedBody["code"]!.GetValue<string>());

        // The status route is operator-only for the same reason: it is an
        // account of the batch, not a visitor's payload.
        var (statusRefused, statusRefusedRaw, statusRefusedBody) = await SendAsync(
            wrong,
            HttpMethod.Get,
            "/api/catalog/refresh/status?region=BR");

        Assert.Equal(HttpStatusCode.Unauthorized, statusRefused);
        Assert.Equal("admin-unauthorized", statusRefusedBody["code"]!.GetValue<string>());

        // Authorization precedes validation: a caller without the token learns
        // nothing about the parameter grammar, and no work is started.
        var (invalidUnauthorized, invalidUnauthorizedRaw, _) = await SendAsync(
            wrong,
            HttpMethod.Post,
            "/api/catalog/refresh?region=brazil");

        Assert.Equal(HttpStatusCode.Unauthorized, invalidUnauthorized);

        var admin = AdminClient();

        var (invalidRegionStatus, invalidRegionRaw, invalidRegionBody) = await SendAsync(
            admin,
            HttpMethod.Post,
            "/api/catalog/refresh?region=brazil");

        Assert.Equal(HttpStatusCode.BadRequest, invalidRegionStatus);
        Assert.Equal("invalid-region", invalidRegionBody["code"]!.GetValue<string>());

        var (invalidModeStatus, invalidModeRaw, invalidModeBody) = await SendAsync(
            admin,
            HttpMethod.Post,
            "/api/catalog/refresh?region=BR&mode=everything");

        Assert.Equal(HttpStatusCode.BadRequest, invalidModeStatus);
        Assert.Equal("invalid-mode", invalidModeBody["code"]!.GetValue<string>());

        var (statusInvalidRegion, statusInvalidRegionRaw, statusInvalidRegionBody) =
            await SendAsync(admin, HttpMethod.Get, "/api/catalog/refresh/status?region=brazil");

        Assert.Equal(HttpStatusCode.BadRequest, statusInvalidRegion);
        Assert.Equal("invalid-region", statusInvalidRegionBody["code"]!.GetValue<string>());

        // None of the refusals started a run, and the status route says so
        // rather than inventing a shape.
        var (noneStatus, noneRaw, noneBody) = await SendAsync(
            admin,
            HttpMethod.Get,
            "/api/catalog/refresh/status?region=BR");

        Assert.Equal(HttpStatusCode.OK, noneStatus);
        Assert.Equal("BR", noneBody["region"]!.GetValue<string>());
        Assert.Equal("none", noneBody["status"]!.GetValue<string>());

        // The token is a credential: it must not be echoed in a response,
        // including the refusal that compared it (FR-017).
        var bodies = new[]
        {
            missingRaw,
            refusedRaw,
            statusRefusedRaw,
            invalidUnauthorizedRaw,
            invalidRegionRaw,
            invalidModeRaw,
            statusInvalidRegionRaw,
            noneRaw,
        };

        Assert.All(bodies, body =>
        {
            Assert.DoesNotContain(CatalogApiFactory.TestAdminToken, body);
            Assert.DoesNotContain(WrongToken, body);
        });

        Assert.False(_api.Logs.Contains(CatalogApiFactory.TestAdminToken));
    }

    [Fact]
    public async Task Starting_a_refresh_answers_accepted_conflicts_while_running_and_reports_the_run()
    {
        await _api.ResetCatalogAsync();

        var admin = AdminClient();

        // Every provider call waits until Release, so the run is observably in
        // flight for the assertions about the accepted/conflict/running shapes.
        _api.Tmdb.Hold();

        var (acceptedStatus, acceptedRaw, acceptedBody) = await SendAsync(
            admin,
            HttpMethod.Post,
            "/api/catalog/refresh?region=BR&mode=normalized");

        Assert.Equal(HttpStatusCode.Accepted, acceptedStatus);
        Assert.True(acceptedBody["started"]!.GetValue<bool>());
        Assert.Equal("BR", acceptedBody["region"]!.GetValue<string>());
        Assert.Equal("Normalized", acceptedBody["mode"]!.GetValue<string>());

        // A second run for the same region is refused rather than queued: a
        // second build would rebuild what the first is already building.
        var (conflictStatus, conflictRaw, conflictBody) = await SendAsync(
            admin,
            HttpMethod.Post,
            "/api/catalog/refresh?region=BR&mode=normalized");

        Assert.Equal(HttpStatusCode.Conflict, conflictStatus);
        Assert.Equal("catalog-refresh-running", conflictBody["code"]!.GetValue<string>());

        // The run row exists before the first provider call is answered, so the
        // status route reports the running shape while the batch is paused —
        // without a completion time, a version, or counts it does not have yet.
        var running = await WaitForStatusAsync(
            admin,
            body => body["status"]?.GetValue<string>() == "Running");

        Assert.Equal("Refresh", running["kind"]!.GetValue<string>());
        Assert.Equal("Normalized", running["mode"]!.GetValue<string>());
        Assert.NotNull(running["startedAt"]);
        Assert.Null(running["completedAt"]);
        Assert.Null(running["versionId"]);
        Assert.Null(running["durationSeconds"]);

        _api.Tmdb.Release();
        await _api.WaitForIdleAsync("BR");

        // The terminal shape is the stored run: a completion time and duration,
        // the promoted version, and one counts line per slice.
        var finished = await WaitForStatusAsync(
            admin,
            body => body["status"]?.GetValue<string>() == "Succeeded");

        Assert.NotNull(finished["completedAt"]);
        Assert.NotNull(finished["durationSeconds"]);
        Assert.NotNull(finished["versionId"]);
        Assert.Empty(finished["failures"]!.AsObject());

        var counts = finished["counts"]!.AsObject();

        Assert.Equal(StubTmdbHandler.QuizServices.Length + 1, counts.Count);

        // No response and no log line carries the token (FR-017).
        Assert.DoesNotContain(CatalogApiFactory.TestAdminToken, acceptedRaw);
        Assert.DoesNotContain(CatalogApiFactory.TestAdminToken, conflictRaw);
        Assert.False(_api.Logs.Contains(CatalogApiFactory.TestAdminToken));
    }
}

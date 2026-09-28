using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using PlayNext.Application.UseCases;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// What an outage looks like from the outside (T027, US3,
/// FR-012/FR-013/FR-014, SC-005).
///
/// US3's claim is not that the provider is reliable — it is that the provider's
/// reliability is not the visitor's problem. So every test here breaks something
/// upstream and then asks the only question that matters to a visitor: what does
/// the deck get? The answers must be a catalog, or the honest "nothing yet" that
/// has a way out. Never an error, never an empty catalog dressed as a real one.
///
/// These run against the real host with the real store, so they are where the
/// two levels of the cache (research D10) become observable — the memory level is
/// emptied for real, and the durable row is read and written for real. The
/// policy itself, and the boundary cases that need a movable clock, are settled
/// in <c>CatalogSnapshotPolicyTests</c>.
/// </summary>
[Collection("catalog")]
public sealed class CatalogOutageTests(CatalogApiFactory api) : CatalogTest(api)
{
    [Fact]
    public async Task A_provider_that_goes_down_after_a_success_keeps_serving_the_titles()
    {
        // FR-012, US3 scenario 1: what the visitor sees during an outage is the
        // catalog from before it. The alternative — an empty deck — would be the
        // app losing the visitor's evening because a third party had a bad
        // minute.
        await _api.ResetCatalogAsync();

        var before = await WaitForAsync("BR");

        _api.Tmdb.IsDown = true;

        var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var during = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal(Ids(before), Ids(during));
    }

    [Fact]
    public async Task A_provider_that_was_never_reachable_answers_not_ready_rather_than_erroring()
    {
        // FR-014, US3 scenario 2: no catalog has ever been retrieved, and now
        // the provider is down. The visitor gets the answer the client renders
        // as its empty state with a way out — never a 500, which would surface
        // as an error screen for a condition the visitor could simply retry.
        await _api.ResetCatalogAsync();

        _api.Tmdb.IsDown = true;

        var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal("catalog-not-ready", body["code"]!.GetValue<string>());

        // SC-005, stated as narrowly as it can be: the body is the shared error
        // contract (004) and nothing else. An exception message or a stack trace
        // riding along here is exactly how an outage becomes an error screen —
        // and this is the one response in the app that is produced *by* a
        // failure, so it is the one worth pinning.
        Assert.Equal(
            ["code", "errors", "retryAfterSeconds"],
            body.Select(member => member.Key).Order());
    }

    [Fact]
    public async Task A_failed_retrieval_leaves_both_levels_exactly_as_they_were()
    {
        // FR-013, US3 scenario 3, and the requirement the rest of US3 is built
        // on: an outage must not be able to destroy the data that makes the
        // outage survivable. The failure is produced the way a real one arrives
        // — through the batch the policy would have run — rather than by writing
        // to the store directly.
        await _api.ResetCatalogAsync();

        var before = await WaitForAsync("BR");
        var storedBefore = await _api.StoredPayloadAsync("BR");

        Assert.NotNull(storedBefore);

        _api.Tmdb.IsDown = true;

        using (var scope = _api.Services.CreateScope())
        {
            var useCases = scope.ServiceProvider.GetRequiredService<CatalogUseCases>();

            await Assert.ThrowsAnyAsync<Exception>(
                () => useCases.RefreshAsync("BR", CancellationToken.None));
        }

        // The durable level, unchanged to the byte.
        Assert.Equal(storedBefore, await _api.StoredPayloadAsync("BR"));

        // And the memory level, which is the one the visitor's next request
        // actually reads.
        var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var during = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal(Ids(before), Ids(during));
    }

    [Fact]
    public async Task A_snapshot_survives_the_process_that_retrieved_it()
    {
        // research D10: the API is hosted scale-to-zero, so the memory level is
        // emptied on every scale-up — and the scale-up usually accompanies the
        // outage that makes the durable level matter. Without it, the first
        // visitor after each restart pays for a full retrieval, and FR-012's
        // "the last successful catalog keeps serving" would be false for exactly
        // the restart it was written for.
        await _api.ResetCatalogAsync();

        var before = await WaitForAsync("BR");

        _api.ClearMemory();
        _api.Tmdb.Requests.Clear();

        var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var after = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal(Ids(before), Ids(after));

        // Served from the durable row: the provider was not asked for anything.
        // A 200 that had quietly re-fetched would satisfy the assertion above
        // while missing the entire point of the level.
        Assert.Empty(_api.Tmdb.Requests);
    }

    [Fact]
    public async Task A_stored_payload_that_cannot_be_read_is_treated_as_absent()
    {
        // Valid jsonb, unusable snapshot — an array where an object belongs, as
        // a botched migration or an older deployment could leave behind. The
        // column type cannot catch this one, so the store has to.
        //
        // Absent is the right reading, not fatal: the region's catalog can
        // simply be retrieved again, and a throw on the request path would be a
        // 500 the client renders as an error screen (SC-005) for a condition
        // that has a working answer.
        await _api.ResetCatalogAsync();

        await _api.StorePayloadAsync("BR", "[1, 2, 3]", DateTimeOffset.UtcNow);

        var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal("catalog-not-ready", body["code"]!.GetValue<string>());

        // And the unreadable row does not stand in the way of the retrieval the
        // refusal started: the region fills normally on the next load.
        await WaitForAsync("BR");
    }

    [Fact]
    public async Task A_provider_that_answers_rate_limited_abandons_the_batch()
    {
        // research D16: a 429 is the provider asking for a pause, and a batch
        // that retries into it is how a soft rate limit becomes a block. The
        // whole refresh is abandoned, which is only acceptable because it is
        // indistinguishable from the outside: the previous snapshot keeps
        // serving and the next stale request tries again.
        await _api.ResetCatalogAsync();

        var before = await WaitForAsync("BR");
        var storedBefore = await _api.StoredPayloadAsync("BR");

        _api.Tmdb.RefusesWith = HttpStatusCode.TooManyRequests;

        // The batch run directly, because a request would not have run one: the
        // snapshot is fresh, so nothing on the request path would have reached
        // the provider at all, and a test that only asked for the catalog would
        // pass without the 429 ever being sent.
        using (var scope = _api.Services.CreateScope())
        {
            var useCases = scope.ServiceProvider.GetRequiredService<CatalogUseCases>();

            var refused = await Assert.ThrowsAsync<HttpRequestException>(
                () => useCases.RefreshAsync("BR", CancellationToken.None));

            // Named rather than generic: the batch has to have failed *because*
            // the provider said to stop, not because of anything else that
            // happens to throw.
            Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        }

        // Abandoned whole. The provider's `Retry-After` is read for the log
        // record — the pause it asks for is longer than any request would wait —
        // so what is asserted here is the decision it drives: nothing is
        // written, and the visitor's next request is served what they had.
        Assert.Equal(storedBefore, await _api.StoredPayloadAsync("BR"));

        var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var during = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal(Ids(before), Ids(during));
    }

    [Fact]
    public async Task A_provider_that_comes_back_fills_the_region_on_the_next_load()
    {
        // quickstart scenario 7, from the visitor's side: the empty state has a
        // way out, and taking it works. The retrieval the refusal started has
        // already failed and released the single-flight gate by the time the
        // visitor retries — which is what makes "try again" a real instruction
        // rather than a hopeful one.
        await _api.ResetCatalogAsync();

        _api.Tmdb.IsDown = true;

        var refused = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);

        _api.Tmdb.IsDown = false;

        var catalog = await WaitForAsync("BR");

        Assert.NotEmpty(Ids(catalog));
    }

    [Fact]
    public async Task Concurrent_loads_of_a_cold_region_produce_one_retrieval()
    {
        // Single-flight (research D16). The case is ordinary rather than rare:
        // a region goes cold, and the visitors who arrive together — a launch,
        // a link, a morning — must not each start their own batch against a
        // provider whose rate limit is soft and enforced.
        //
        // Asserted by counting what upstream actually saw, because that is the
        // resource being protected. A batch is not one call but several hundred,
        // so ten batches would be unmistakable.
        await _api.ResetCatalogAsync();

        await WaitForAsync("BR");

        var oneBatch = _api.Tmdb.Requests.Count;

        Assert.True(oneBatch > 0, "a warm region should have cost at least one upstream call");

        await _api.ResetCatalogAsync();

        var client = _api.CreateClient();

        await Task.WhenAll(
            Enumerable.Range(0, 10).Select(_ => client.GetAsync("/api/catalog?region=BR")));

        await WaitForAsync("BR");

        Assert.Equal(oneBatch, _api.Tmdb.Requests.Count);
    }
}

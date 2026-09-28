using System.Net;
using System.Text.Json.Nodes;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Region-scoped truth (T022, US2, FR-005/FR-006).
///
/// The claim these settle is the one the whole product rests on: a badge is a
/// promise that the visitor can watch this tonight, and a promise made for the
/// wrong country is worse than none — it costs a tap to discover it was empty
/// (constitution II). So the assertions are about *differences*: the same film
/// carries different services in two regions, and neither region's answer
/// leaks into the other's.
///
/// The stub is built for exactly this: Inception is carried by Netflix and a
/// service outside the vocabulary in BR, by Hulu in the US, and by Netflix in
/// GB. Every case below reads one of those rows.
/// </summary>
[Collection("catalog")]
public sealed class CatalogRegionTests(CatalogApiFactory api) : CatalogTest(api)
{
    [Fact]
    public async Task The_same_title_carries_the_services_that_carry_it_where_the_visitor_is()
    {
        await _api.ResetCatalogAsync();

        var brazil = await WaitForAsync("BR");
        var unitedStates = await WaitForAsync("US");

        var inBrazil = BadgeIds(TitleById(brazil, "tmdb:movie:27205"));
        var inTheStates = BadgeIds(TitleById(unitedStates, "tmdb:movie:27205"));

        Assert.Contains("netflix", inBrazil);
        Assert.Contains("hulu", inTheStates);

        // The half that matters more, and the half a snapshot keyed by nothing
        // would fail: the Brazilian answer must not contain the American one,
        // and the American answer must not be the Brazilian one under a
        // different name.
        Assert.DoesNotContain("hulu", inBrazil);
        Assert.DoesNotContain("netflix", inTheStates);
    }

    [Fact]
    public async Task A_region_scopes_availability_and_never_the_title_list()
    {
        // The pool is discovered by genre, without a region filter, and only the
        // availability lookup is scoped (research D8). That is not an accident
        // of the implementation: the client's filter 3 decides eligibility from
        // the badges, and a title missing from a region's catalog could never be
        // decided on at all — the card would not degrade, it would not exist
        // (FR-006, US2 scenario 3).
        await _api.ResetCatalogAsync();

        var brazil = await WaitForAsync("BR");
        var unitedStates = await WaitForAsync("US");

        Assert.Equal(Ids(brazil), Ids(unitedStates));
    }

    [Fact]
    public async Task A_title_only_rentable_in_a_region_carries_no_badge_there()
    {
        await _api.ResetCatalogAsync();

        var brazil = await WaitForAsync("BR");
        var unitedStates = await WaitForAsync("US");

        // Interstellar is rent-only in BR and flatrate in the US in the stub.
        // A rental is not "what you can watch tonight on a service you already
        // pay for", so BR gets no badge for it while the US gets one (research
        // D5).
        Assert.Empty(BadgeIds(TitleById(brazil, "tmdb:movie:157336")));
        Assert.Contains("disney-plus", BadgeIds(TitleById(unitedStates, "tmdb:movie:157336")));
    }

    [Fact]
    public async Task A_title_carried_nowhere_in_the_region_is_still_offered()
    {
        await _api.ResetCatalogAsync();

        var brazil = await WaitForAsync("BR");

        // Fight Club is carried nowhere in BR — not filtered, not an error, not
        // a missing card. It is a title the visitor could still decide on, and
        // hiding it would be the catalog deciding for them (FR-006).
        var fightClub = TitleById(brazil, "tmdb:movie:550");

        Assert.Empty(BadgeIds(fightClub));
        Assert.Equal("Fight Club", fightClub["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_region_never_retrieved_says_so_rather_than_reporting_nothing_to_watch()
    {
        await _api.ResetCatalogAsync();

        // Brazil is warmed; the United States has never been asked for. The
        // answer to that is "not ready yet" — never an empty catalog, which the
        // deck would render as "nothing matches your filters" and blame the
        // visitor's quiz answers for (FR-014, contracts/catalog.md).
        await WaitForAsync("BR");

        var response = await _api.CreateClient().GetAsync("/api/catalog?region=US");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

        Assert.Equal("catalog-not-ready", body["code"]!.GetValue<string>());

        // The refused-in-the-empty-sense answer starts a retrieval behind the
        // response, and this test provoked one on purpose. Letting it land
        // before the test ends keeps the next test's reset a reset — otherwise
        // a batch still in flight would finish after it, and the next test
        // would begin with a region already warm that it believed cold.
        await WaitForAsync("US");
    }

    [Fact]
    public async Task Each_region_is_retrieved_from_the_provider_for_that_region()
    {
        // The availability lookup is the only call that carries the region, and
        // it has to carry it: an upstream asked without one answers for the
        // provider's own default, which is how a Brazilian visitor ends up with
        // American badges and no error anywhere to explain it.
        await _api.ResetCatalogAsync();

        await WaitForAsync("BR");
        await WaitForAsync("US");

        Assert.Contains(_api.Tmdb.Requests, request => request.Contains("watch_region=BR", StringComparison.Ordinal));
        Assert.Contains(_api.Tmdb.Requests, request => request.Contains("watch_region=US", StringComparison.Ordinal));
    }
}

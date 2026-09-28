using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Defines the collection the catalog suites share.
///
/// A collection fixture rather than a class fixture, because the suites share
/// two things: one durable snapshot table and one region vocabulary. They run
/// one at a time rather than racing each other's resets — xUnit's default is
/// per-class parallelism, which would be wrong here, since two classes warming
/// the same region would each see the other's snapshot and neither could assert
/// what it meant to.
/// </summary>
[CollectionDefinition("catalog")]
public sealed class CatalogCollection : ICollectionFixture<CatalogApiFactory>;

/// <summary>
/// What every catalog suite needs: the host, and the two readings of its
/// answers that more than one suite performs.
/// </summary>
public abstract class CatalogTest(CatalogApiFactory api)
{
    protected CatalogApiFactory _api { get; } = api;

    /// <summary>
    /// The catalog as the deck would receive it, having waited for the first
    /// retrieval to finish.
    ///
    /// The wait is the client's own retry, not a test-only affordance: a cold
    /// catalog answers "not ready", and the visitor's next load gets titles
    /// (FR-014). Polling here is that next load, repeated.
    /// </summary>
    protected async Task<JsonObject> WarmAsync(string region = "BR")
    {
        await _api.ResetCatalogAsync();

        return await WaitForAsync(region);
    }

    /// <summary>
    /// The catalog for a region, polling until its first retrieval finishes —
    /// without clearing anything first.
    ///
    /// Separate from <see cref="WarmAsync"/> for the suites that need two
    /// regions in hand at once: a reset between them would delete the snapshot
    /// the first one had just proved, and a comparison between two regions
    /// would have nothing left to compare.
    /// </summary>
    protected async Task<JsonObject> WaitForAsync(string region)
    {
        var client = _api.CreateClient();

        for (var attempt = 0; attempt < 60; attempt++)
        {
            var response = await client.GetAsync($"/api/catalog?region={region}");

            if (response.StatusCode == HttpStatusCode.OK)
            {
                var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

                if (body["titles"]!.AsArray().Count > 0)
                {
                    return body;
                }
            }

            await Task.Delay(250);
        }

        throw new InvalidOperationException($"The catalog for {region} never became ready.");
    }

    protected static JsonObject TitleById(JsonObject catalog, string id) =>
        catalog["titles"]!.AsArray()
            .Select(node => node!.AsObject())
            .Single(title => title["id"]!.GetValue<string>() == id);

    /// <summary>Every title id in a catalog, in the order it serves them.</summary>
    protected static string[] Ids(JsonObject catalog) =>
        [.. catalog["titles"]!.AsArray().Select(title => title!.AsObject()["id"]!.GetValue<string>())];

    protected static string[] BadgeIds(JsonObject title) =>
        [.. title["availability"]!.AsArray()
            .Select(node => node!.AsObject()["providerId"]!.GetValue<string>())];
}

/// <summary>
/// Contract tests for <c>GET /api/catalog</c> (T012), driving the real host
/// with the provider stubbed at the socket.
///
/// These assert the shape the client actually consumes, field by field, and
/// they assert it for the titles that are awkward rather than only for the
/// happy one: a Western animated film, a Japanese live-action film, a title
/// with no artwork, and a title carried only by a service the vocabulary does
/// not know. Those are the four places a plausible implementation is wrong, and
/// each has a test named after it.
/// </summary>
public sealed class CatalogTests
{
    [Collection("catalog")]
    public sealed class Serving_the_pool(CatalogApiFactory api) : CatalogTest(api)
    {
        [Fact]
        public async Task A_cold_region_is_not_ready_rather_than_empty()
        {
            // FR-014. 503 with a code, not 200 with an empty array: an empty
            // array would look like a catalog that happens to have nothing in
            // it, and the client would cache that emptiness as though it were
            // the catalog (research D11).
            await _api.ResetCatalogAsync();

            var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

            var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

            Assert.Equal("catalog-not-ready", body["code"]!.GetValue<string>());
        }

        [Fact]
        public async Task The_catalog_needs_no_session()
        {
            // Constitution III, guest-first: a visitor who has answered the quiz
            // must never be asked who they are before seeing titles.
            var catalog = await WarmAsync();

            Assert.True(catalog["titles"]!.AsArray().Count > 0);
        }

        [Fact]
        public async Task Every_title_carries_a_provider_prefixed_identity()
        {
            var catalog = await WarmAsync();

            var ids = new List<string>();

            foreach (var title in catalog["titles"]!.AsArray())
            {
                var id = title!["id"]!.GetValue<string>();

                Assert.Matches(@"^tmdb:(movie|tv):\d+$", id);
                ids.Add(id);
            }

            // The pool is a union of overlapping queries, so the same title is
            // reachable several ways; identity is what makes it one title.
            Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
        }

        [Fact]
        public async Task A_title_carries_everything_a_card_and_detail_view_render()
        {
            // FR-020: the pool is complete, so opening a title never needs a
            // second request. Asserted on one title field by field rather than
            // by checking a few fields across many.
            var inception = TitleById(await WarmAsync(), "tmdb:movie:27205");

            Assert.Equal("Inception", inception["title"]!.GetValue<string>());
            Assert.Equal(2010, inception["releaseYear"]!.GetValue<int>());
            Assert.Equal("movie", inception["mediaType"]!.GetValue<string>());
            Assert.Equal("A thief who steals corporate secrets.", inception["synopsis"]!.GetValue<string>());
            Assert.Equal(8.4, inception["rating"]!.GetValue<double>(), precision: 1);
            Assert.Equal(36_000, inception["voteCount"]!.GetValue<int>());
            Assert.Equal(148, inception["runtimeMinutes"]!.GetValue<int>());

            // The poster is the provider's image CDN, at the one size the
            // catalog asks for (FR-001's carve-out, research D12).
            Assert.Equal(
                "https://image.tmdb.org/t/p/w500/inception.jpg",
                inception["posterUrl"]!.GetValue<string>());

            Assert.Equal(
                "https://www.youtube.com/watch?v=YoHD9XEInc0",
                inception["trailerUrl"]!.GetValue<string>());
        }

        [Fact]
        public async Task A_series_carries_no_runtime()
        {
            // Episode lengths are not a title runtime; the field is absent so
            // the card degrades rather than printing a misleading number.
            var breakingBad = TitleById(await WarmAsync(), "tmdb:tv:1396");

            Assert.Equal("tv", breakingBad["mediaType"]!.GetValue<string>());
            Assert.Null(breakingBad["runtimeMinutes"]);
        }

        [Fact]
        public async Task A_title_with_no_artwork_carries_no_poster_url()
        {
            // FR-017: the client falls back to its CSS placeholder, which it can
            // only do if the absence is expressed as an absent field.
            var fightClub = TitleById(await WarmAsync(), "tmdb:movie:550");

            Assert.Null(fightClub["posterUrl"]);
        }

        [Fact]
        public async Task Genres_use_the_quiz_s_own_vocabulary_and_keep_the_rest_as_tags()
        {
            var interstellar = TitleById(await WarmAsync(), "tmdb:movie:157336");

            var genres = interstellar["genres"]!.AsArray()
                .Select(genre => genre!.GetValue<string>())
                .ToArray();

            // 878 is one of the nine; 12 (Adventure) is not, and is carried as
            // a readable tag rather than dropped or made numeric.
            Assert.Equal(["sci-fi", "adventure"], genres);
        }
    }

    [Collection("catalog")]
    public sealed class The_anime_rule_on_the_wire(CatalogApiFactory api) : CatalogTest(api)
    {
        [Fact]
        public async Task Japanese_animation_is_anime_and_keeps_a_movie_identity()
        {
            var spiritedAway = TitleById(await WarmAsync(), "tmdb:movie:129");

            Assert.Equal("anime", spiritedAway["mediaType"]!.GetValue<string>());

            // Identity keeps the type the provider filed it under, so it does
            // not move if the classification rule is revisited (research D9).
            Assert.Equal("tmdb:movie:129", spiritedAway["id"]!.GetValue<string>());
        }

        [Fact]
        public async Task Western_animation_is_a_movie()
        {
            var toyStory = TitleById(await WarmAsync(), "tmdb:movie:862");

            Assert.Equal("movie", toyStory["mediaType"]!.GetValue<string>());
        }

        [Fact]
        public async Task Japanese_live_action_is_a_movie()
        {
            var sevenSamurai = TitleById(await WarmAsync(), "tmdb:movie:346");

            Assert.Equal("movie", sevenSamurai["mediaType"]!.GetValue<string>());
        }
    }

    [Collection("catalog")]
    public sealed class Availability_on_the_wire(CatalogApiFactory api) : CatalogTest(api)
    {
        [Fact]
        public async Task A_badge_names_its_service_and_carries_a_final_link()
        {
            var inception = TitleById(await WarmAsync(), "tmdb:movie:27205");

            var badges = inception["availability"]!.AsArray()
                .Select(node => node!.AsObject())
                .ToDictionary(
                    badge => badge["providerId"]!.GetValue<string>(),
                    badge => badge["deepLinkUrl"]!.GetValue<string>());

            // The quiz's own id for a service it offers…
            Assert.Equal("https://www.netflix.com/search?q=Inception", badges["netflix"]);

            // …and a pass-through for one it does not, still tappable (FR-010).
            Assert.Equal("https://pluto.tv/en/search?q=Inception", badges["tmdb:300"]);
        }

        [Fact]
        public async Task A_title_carried_nowhere_has_an_empty_badge_list()
        {
            // Empty is a normal answer, not an error and not a hidden title.
            var fightClub = TitleById(await WarmAsync(), "tmdb:movie:550");

            Assert.Empty(fightClub["availability"]!.AsArray());
        }

        [Fact]
        public async Task A_rental_only_offer_is_not_an_availability()
        {
            // Interstellar is on rent in BR and on a subscription in the US, so
            // the same title reads as unavailable in one region and available
            // in the other — which is the whole point of the region input.
            var interstellar = TitleById(await WarmAsync(), "tmdb:movie:157336");

            Assert.Empty(interstellar["availability"]!.AsArray());
        }

        [Fact]
        public async Task A_service_the_vocabulary_cannot_address_is_excluded()
        {
            // The template-coverage rule (research D7): a badge that cannot be
            // followed is a dead end, so the service is dropped and logged
            // rather than rendered as a link to nowhere.
            var sevenSamurai = TitleById(await WarmAsync(), "tmdb:movie:346");

            Assert.Empty(sevenSamurai["availability"]!.AsArray());
        }

        [Fact]
        public async Task An_ad_supported_tier_still_names_the_service_the_visitor_picked()
        {
            // Toy Story is carried by TMDB ids 1796 and 192 in BR. 1796 is
            // Netflix's ad-supported tier and must read as Netflix — a visitor
            // who picked Netflix is not told a Netflix title is unavailable on
            // Netflix.
            var badges = BadgeIds(TitleById(await WarmAsync(), "tmdb:movie:862"));

            Assert.Contains("netflix", badges);
            Assert.Contains("tmdb:192", badges);
        }
    }

    [Collection("catalog")]
    public sealed class Refusing_a_bad_region(CatalogApiFactory api) : CatalogTest(api)
    {
        [Theory]
        [InlineData("br")]      // the right country, the wrong case
        [InlineData("BRA")]
        [InlineData("B")]
        [InlineData("1R")]
        [InlineData("")]
        public async Task A_region_that_is_not_an_iso_code_is_refused(string region)
        {
            await _api.ResetCatalogAsync();

            var response = await _api.CreateClient().GetAsync($"/api/catalog?region={region}");

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

            var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

            Assert.Equal("invalid-region", body["code"]!.GetValue<string>());
        }

        [Fact]
        public async Task A_missing_region_is_refused()
        {
            await _api.ResetCatalogAsync();

            var response = await _api.CreateClient().GetAsync("/api/catalog");

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [Fact]
        public async Task A_refused_region_does_not_start_a_retrieval()
        {
            // A malformed request must not cost a 600-call upstream batch.
            await _api.ResetCatalogAsync();

            await _api.CreateClient().GetAsync("/api/catalog?region=nope");

            Assert.Empty(_api.Tmdb.Requests);
        }
    }

    /// <summary>
    /// The pool arrives compressed (SC-002's second lever).
    ///
    /// The pool is the one large response this API serves — measured at 382 KB
    /// for BR against the live provider on 2026-09-28 — and it is served to
    /// phones. Compression is the cheapest thing that can be done about that,
    /// and it is worth a test rather than a line of configuration because the
    /// failure mode is silent: middleware registered but ordered after the
    /// endpoints compiles, starts, and compresses nothing.
    /// </summary>
    [Collection("catalog")]
    public sealed class Compressing_the_pool(CatalogApiFactory api) : CatalogTest(api)
    {
        [Fact]
        public async Task The_pool_is_compressed_when_the_client_asks_for_it()
        {
            await WarmAsync();

            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/catalog?region=BR");
            request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

            using var response = await _api.CreateClient().SendAsync(request);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains(
                response.Content.Headers.ContentEncoding,
                encoding => string.Equals(encoding, "gzip", StringComparison.OrdinalIgnoreCase));
        }

        [Fact]
        public async Task The_pool_is_still_served_in_full_without_it()
        {
            // Compression is a negotiation. A client that did not ask — an old
            // proxy, a test harness, curl with no flags — must still get the
            // catalog, and get all of it.
            var catalog = await WarmAsync();

            using var response = await _api.CreateClient().GetAsync("/api/catalog?region=BR");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Empty(response.Content.Headers.ContentEncoding);

            var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();

            Assert.Equal(catalog["titles"]!.AsArray().Count, body["titles"]!.AsArray().Count);
        }
    }
}

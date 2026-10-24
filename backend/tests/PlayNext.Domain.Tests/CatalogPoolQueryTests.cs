using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The read request's normalization and validation (contracts/catalog-api.md,
/// FR-021/FR-027).
///
/// The important half of this suite is what is <b>not</b> an error. Services and
/// genres are data: a well-formed value the catalog does not currently know
/// selects nothing, because a 400 for <c>services=globoplay</c> before
/// Globoplay has been discovered would punish the client for asking a question
/// the server can answer with an empty pool. Only a syntactically impossible
/// value is rejected, and the tests below pin both sides of that line.
/// </summary>
public class CatalogPoolQueryTests
{
    private const int MaxIdsPerRequest = 1000;

    private static CatalogPoolQueryResult Parse(
        string? services = null,
        string? genres = null,
        string? mediaTypes = null,
        string? ids = null,
        int maxIds = MaxIdsPerRequest) =>
        CatalogPoolQueryParser.Parse(services, genres, mediaTypes, ids, maxIds);

    private static CatalogPoolQuery Valid(CatalogPoolQueryResult result)
    {
        Assert.True(result.IsValid, $"expected a valid query, got '{result.ErrorCode}'");
        return result.Query!;
    }

    public class Normalization
    {
        [Fact]
        public void No_parameters_is_the_general_request()
        {
            var query = Valid(Parse());

            Assert.Empty(query.Services);
            Assert.Empty(query.Genres);
            Assert.Empty(query.MediaTypes);
            Assert.Empty(query.Ids);
            Assert.False(query.HasFilters);
            Assert.False(query.HasIds);
            Assert.True(query.IsGeneral);
        }

        [Fact]
        public void Values_are_trimmed_and_empty_ones_ignored()
        {
            // A trailing comma and a stray space are what a hand-built URL looks
            // like; treating either as an empty service id would fail a request
            // that is unambiguous to a human.
            var query = Valid(Parse(services: " netflix , , prime-video ,", genres: " , horror, "));

            Assert.Equal(new[] { "netflix", "prime-video" }, query.Services);
            Assert.Equal(new[] { "horror" }, query.Genres);
        }

        [Fact]
        public void Duplicates_are_removed_in_first_seen_order()
        {
            var query = Valid(Parse(
                services: "netflix,prime-video,netflix",
                genres: "horror,horror",
                mediaTypes: "movie,tv,movie",
                ids: "tmdb:movie:1,tmdb:movie:1"));

            Assert.Equal(new[] { "netflix", "prime-video" }, query.Services);
            Assert.Equal(new[] { "horror" }, query.Genres);
            Assert.Equal(new[] { CatalogMediaType.Movie, CatalogMediaType.Tv }, query.MediaTypes);
            Assert.Equal(new[] { "tmdb:movie:1" }, query.Ids);
        }

        [Fact]
        public void Several_values_in_one_dimension_are_kept_side_by_side()
        {
            // OR within a dimension: all four values survive parsing, and the
            // dimensions stay separate lists so the reader ANDs them.
            var query = Valid(Parse(
                services: "netflix,prime-video",
                genres: "horror,thriller",
                mediaTypes: "movie,tv"));

            Assert.Equal(2, query.Services.Count);
            Assert.Equal(2, query.Genres.Count);
            Assert.Equal(2, query.MediaTypes.Count);
            Assert.True(query.HasFilters);
            Assert.False(query.IsGeneral);
        }

        [Fact]
        public void Ids_alone_do_not_make_a_general_request()
        {
            var query = Valid(Parse(ids: "tmdb:movie:27205"));

            Assert.False(query.HasFilters);
            Assert.True(query.HasIds);
            Assert.False(query.IsGeneral);
        }
    }

    public class The_service_rule
    {
        [Theory]
        [InlineData("netflix")]
        [InlineData("prime-video")]
        [InlineData("a")]
        [InlineData("tmdb:8")]
        [InlineData("tmdb:1234567890")]
        public void Accepts_lowercase_ids_and_provider_passthroughs(string value)
        {
            Assert.Equal(value, Assert.Single(Valid(Parse(services: value)).Services));
        }

        [Theory]
        [InlineData("Netflix")]
        [InlineData("NETFLIX")]
        [InlineData("-netflix")]
        [InlineData("netflix_plus")]
        [InlineData("netflix.com")]
        [InlineData("netflix/br")]
        [InlineData("net flix")]
        [InlineData("tmdb:")]
        [InlineData("tmdb:abc")]
        [InlineData("tmdb:12345678901")]
        [InlineData("tmdb:-1")]
        public void Rejects_anything_else(string value)
        {
            var result = Parse(services: value);

            Assert.False(result.IsValid);
            Assert.Equal("invalid-service", result.ErrorCode);
            Assert.NotNull(result.Error);
        }

        [Fact]
        public void A_64_character_id_is_accepted_and_a_65_character_one_is_not()
        {
            var sixtyFour = new string('a', CatalogPoolQueryParser.MaxVocabularyValueLength);

            Assert.True(Parse(services: sixtyFour).IsValid);
            Assert.Equal("invalid-service", Parse(services: sixtyFour + "a").ErrorCode);
        }
    }

    public class The_genre_rule
    {
        [Theory]
        [InlineData("action")]
        [InlineData("sci-fi")]
        [InlineData("sci-fi-and-fantasy")]
        [InlineData("9")]
        public void Accepts_lowercase_slugs(string value)
        {
            Assert.Equal(value, Assert.Single(Valid(Parse(genres: value)).Genres));
        }

        [Theory]
        [InlineData("Action")]
        [InlineData("-horror")]
        [InlineData("horror thriller")]
        [InlineData("a.b")]
        [InlineData("horror,thriller_x")]
        [InlineData("tmdb:27")]
        public void Rejects_anything_else(string value)
        {
            Assert.Equal("invalid-genre", Parse(genres: value).ErrorCode);
        }
    }

    public class The_media_type_rule
    {
        [Theory]
        [InlineData("movie", CatalogMediaType.Movie)]
        [InlineData("tv", CatalogMediaType.Tv)]
        [InlineData("anime", CatalogMediaType.Anime)]
        public void Accepts_the_three_presentation_types(string wire, CatalogMediaType expected)
        {
            Assert.Equal(expected, Assert.Single(Valid(Parse(mediaTypes: wire)).MediaTypes));
        }

        [Theory]
        [InlineData("documentary")]
        [InlineData("Movie")]
        [InlineData("series")]
        [InlineData("film")]
        public void Rejects_anything_else(string value)
        {
            Assert.Equal("invalid-media-type", Parse(mediaTypes: value).ErrorCode);
        }
    }

    public class The_title_id_rule
    {
        [Theory]
        [InlineData("tmdb:movie:27205")]
        [InlineData("tmdb:tv:1396")]
        [InlineData("tmdb:movie:1")]
        [InlineData("tmdb:tv:1234567890")]
        public void Accepts_provider_movie_and_tv_ids(string value)
        {
            Assert.Equal(value, Assert.Single(Valid(Parse(ids: value)).Ids));
        }

        [Theory]
        [InlineData("hereditary")]
        [InlineData("tmdb:anime:1")]
        [InlineData("tmdb:movie:")]
        [InlineData("tmdb:movie:abc")]
        [InlineData("tmdb:movie:12345678901")]
        [InlineData("TMDB:movie:1")]
        [InlineData("tmdb:person:1")]
        public void Rejects_anything_else(string value)
        {
            Assert.Equal("invalid-title-id", Parse(ids: value).ErrorCode);
        }
    }

    public class The_id_bound
    {
        [Fact]
        public void Exactly_one_thousand_ids_are_accepted()
        {
            var ids = string.Join(',', Enumerable.Range(1, MaxIdsPerRequest).Select(id => $"tmdb:movie:{id}"));

            Assert.Equal(MaxIdsPerRequest, Valid(Parse(ids: ids)).Ids.Count);
        }

        [Fact]
        public void One_thousand_and_one_ids_are_too_many()
        {
            var ids = string.Join(',', Enumerable.Range(1, MaxIdsPerRequest + 1).Select(id => $"tmdb:movie:{id}"));

            var result = Parse(ids: ids);

            Assert.False(result.IsValid);
            Assert.Equal("too-many-ids", result.ErrorCode);
        }

        [Fact]
        public void The_bound_is_the_configured_one_not_a_fixed_number()
        {
            Assert.True(Parse(ids: "tmdb:movie:1,tmdb:movie:2", maxIds: 2).IsValid);
            Assert.Equal("too-many-ids", Parse(ids: "tmdb:movie:1,tmdb:movie:2,tmdb:movie:3", maxIds: 2).ErrorCode);
        }

        [Fact]
        public void The_bound_is_checked_before_individual_ids()
        {
            // "first error wins" applies across the whole parse: a request that
            // is both oversized and malformed reports the size, which is the
            // one the caller can fix by splitting the batch.
            var ids = string.Join(',', Enumerable.Repeat("not-a-title", MaxIdsPerRequest + 1));

            Assert.Equal("too-many-ids", Parse(ids: ids).ErrorCode);
        }
    }

    public class Error_order
    {
        [Fact]
        public void The_first_offending_dimension_wins()
        {
            Assert.Equal("invalid-service", Parse(services: "Netflix", genres: "Bad", mediaTypes: "film", ids: "x").ErrorCode);
            Assert.Equal("invalid-genre", Parse(services: "netflix", genres: "Bad", mediaTypes: "film", ids: "x").ErrorCode);
            Assert.Equal("invalid-media-type", Parse(services: "netflix", genres: "horror", mediaTypes: "film", ids: "x").ErrorCode);
            Assert.Equal("invalid-title-id", Parse(services: "netflix", genres: "horror", mediaTypes: "movie", ids: "x").ErrorCode);
        }

        [Fact]
        public void An_invalid_request_has_no_query_to_use()
        {
            Assert.Null(Parse(services: "Netflix").Query);
        }
    }

    public class Unknown_but_well_formed_values
    {
        [Fact]
        public void Select_nothing_rather_than_failing()
        {
            // FR-021: the vocabulary is data. These are the exact requests the
            // client will send the day a new service or genre ships, before any
            // region's catalog contains a row for it.
            var query = Valid(Parse(services: "no-such-service", genres: "no-such-genre", mediaTypes: "movie"));

            Assert.Equal("no-such-service", Assert.Single(query.Services));
            Assert.Equal("no-such-genre", Assert.Single(query.Genres));
        }
    }

    public class The_cache_key
    {
        [Fact]
        public void Is_independent_of_order_within_every_dimension()
        {
            var forward = Valid(Parse(
                services: "netflix,prime-video",
                genres: "horror,thriller",
                mediaTypes: "movie,tv",
                ids: "tmdb:movie:1,tmdb:tv:2"));

            var reversed = Valid(Parse(
                services: "prime-video,netflix",
                genres: "thriller,horror",
                mediaTypes: "tv,movie",
                ids: "tmdb:tv:2,tmdb:movie:1"));

            Assert.Equal(forward.CacheKey, reversed.CacheKey);
        }

        [Fact]
        public void Distinguishes_different_requests()
        {
            var keys = new[]
            {
                Valid(Parse()).CacheKey,
                Valid(Parse(services: "netflix")).CacheKey,
                Valid(Parse(services: "max")).CacheKey,
                Valid(Parse(genres: "horror")).CacheKey,
                Valid(Parse(mediaTypes: "movie")).CacheKey,
                Valid(Parse(ids: "tmdb:movie:1")).CacheKey,
            };

            Assert.Equal(keys.Length, keys.Distinct(StringComparer.Ordinal).Count());
        }

        [Fact]
        public void Does_not_depend_on_how_the_values_were_spaced_or_deduplicated()
        {
            // The key is built from the normalized query, so a hand-built URL
            // with spaces and repeats hits the same cache entry.
            Assert.Equal(
                Valid(Parse(services: "netflix,prime-video")).CacheKey,
                Valid(Parse(services: " netflix, netflix ,prime-video, ")).CacheKey);
        }
    }
}

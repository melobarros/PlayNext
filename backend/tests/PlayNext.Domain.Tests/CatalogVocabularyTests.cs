using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The provider/genre translation vocabulary — a named critical path
/// (constitution V: "mapping and classification rules"), so these tests were
/// written before <see cref="CatalogVocabulary"/> had a body.
///
/// The seeds asserted here are load-bearing in a way a normal mapping table is
/// not: 001's genre and provider identifiers are already written into
/// preferences stored on visitors' devices under a frozen storage contract, so
/// a wrong id here silently stops matching a preference that was saved months
/// ago. The tests name the ids literally rather than deriving them from the
/// table, because a table that agreed with itself would prove nothing.
/// </summary>
public class CatalogVocabularyTests
{
    public class The_genre_seed
    {
        [Theory]
        [InlineData(28, "action")]
        [InlineData(35, "comedy")]
        [InlineData(18, "drama")]
        [InlineData(27, "horror")]
        [InlineData(10749, "romance")]
        [InlineData(878, "sci-fi")]
        [InlineData(53, "thriller")]
        [InlineData(16, "animation")]
        [InlineData(99, "documentary")]
        public void Maps_each_quiz_genre_to_its_001_id(int tmdbId, string quizId)
        {
            Assert.Equal(quizId, CatalogVocabulary.ToGenreId(tmdbId));
        }

        [Fact]
        public void Covers_exactly_the_nine_the_quiz_offers()
        {
            // Nine, not "at least nine": a tenth entry would mean the server
            // knows a genre no visitor can pick and the client cannot filter.
            Assert.Equal(9, CatalogVocabulary.GenreMap.Count);
        }

        [Fact]
        public void Leaves_a_genre_the_quiz_does_not_offer_unmapped()
        {
            // Adventure (12) is real, common, and not one of the nine.
            Assert.Null(CatalogVocabulary.ToGenreId(12));
        }
    }

    public class Mapping_a_title_s_genres
    {
        [Fact]
        public void Returns_the_001_ids_in_the_order_the_provider_reported_them()
        {
            var mapped = CatalogVocabulary.MapGenres([878, 53, 28]);

            Assert.Equal(["sci-fi", "thriller", "action"], mapped);
        }

        [Fact]
        public void Keeps_an_unmapped_genre_as_a_tag_rather_than_dropping_it()
        {
            // FR-010's spirit, applied to genres: a genre the visitor cannot
            // pick must not make the title look like it has fewer genres than
            // it does. The tag is readable, not a numeric id.
            var mapped = CatalogVocabulary.MapGenres([12, 80]);

            Assert.Equal(["adventure", "crime"], mapped);
        }

        [Fact]
        public void Puts_the_quiz_s_genres_before_the_extra_tags()
        {
            var mapped = CatalogVocabulary.MapGenres([12, 28]);

            Assert.Equal(["action", "adventure"], mapped);
        }

        [Fact]
        public void Does_not_repeat_a_genre_the_provider_reported_twice()
        {
            var mapped = CatalogVocabulary.MapGenres([28, 28, 12, 12]);

            Assert.Equal(["action", "adventure"], mapped);
        }

        [Fact]
        public void Tags_the_provider_s_own_multi_word_genres_readably()
        {
            // 10765 is TMDB's "Sci-Fi & Fantasy" — a TV genre. Its tag must not
            // collide with the quiz's "sci-fi" (878), or a filter would match a
            // genre the visitor did not pick.
            var mapped = CatalogVocabulary.MapGenres([10765]);

            Assert.Equal(["sci-fi-and-fantasy"], mapped);
        }

        [Fact]
        public void Yields_nothing_for_a_title_with_no_genres()
        {
            Assert.Empty(CatalogVocabulary.MapGenres([]));
        }
    }

    public class The_provider_seed
    {
        [Theory]
        [InlineData(8, "netflix")]
        [InlineData(119, "prime-video")]
        [InlineData(337, "disney-plus")]
        [InlineData(1899, "max")]
        [InlineData(350, "apple-tv-plus")]
        [InlineData(531, "paramount-plus")]
        [InlineData(283, "crunchyroll")]
        [InlineData(11, "mubi")]
        [InlineData(307, "globoplay")]
        // Star+ (619) is absent on purpose. The service was discontinued and
        // TMDB stopped listing the id, so there is nothing left to map to
        // `star-plus`. See CatalogVocabulary's summary.
        [InlineData(15, "hulu")]
        [InlineData(386, "peacock")]
        public void Maps_each_quiz_service_to_its_001_id(int tmdbId, string quizId)
        {
            Assert.True(CatalogVocabulary.TryGetProvider(tmdbId, out var provider));
            Assert.Equal(quizId, provider.ProviderId);
        }

        [Theory]
        [InlineData(1796, "netflix")]       // "Netflix Standard with Ads"
        [InlineData(2100, "prime-video")]   // "Amazon Prime Video with Ads"
        public void Resolves_a_regional_or_tier_variant_to_the_same_service(int tmdbId, string quizId)
        {
            // The visitor picked "Netflix", not "Netflix Standard with Ads". A
            // tier TMDB lists separately is still that service carrying the
            // title, and a filter that missed it would under-report
            // availability.
            //
            // Max used to be the third case here, until its two ids collapsed
            // into one (see the seed table).
            Assert.True(CatalogVocabulary.TryGetProvider(tmdbId, out var provider));
            Assert.Equal(quizId, provider.ProviderId);
        }

        [Fact]
        public void Covers_every_service_the_twelve_are_in()
        {
            // The twelve are a floor, never a ceiling (FR-010). Anything the
            // table knows that has no 001 id still gets a stable one.
            Assert.All(
                CatalogVocabulary.Providers,
                provider => Assert.False(string.IsNullOrWhiteSpace(provider.ProviderId)));
        }

        [Fact]
        public void Gives_a_service_outside_the_quiz_a_tmdb_prefixed_id()
        {
            Assert.True(CatalogVocabulary.TryGetProvider(300, out var provider));

            Assert.Equal("tmdb:300", provider.ProviderId);
            Assert.Equal("Pluto TV", provider.DisplayName);
        }

        [Fact]
        public void Every_seeded_service_can_be_linked_to()
        {
            // The template-coverage invariant (research D7). A badge exists to
            // be tapped, so a service with no search template must never be
            // seeded at all — it would render a link that goes nowhere, which
            // is the dead end FR-007 exists to remove.
            Assert.All(
                CatalogVocabulary.Providers,
                provider => Assert.False(string.IsNullOrWhiteSpace(provider.SearchTemplate)));
        }

        [Fact]
        public void Knows_nothing_about_a_service_it_has_never_heard_of()
        {
            // Extinct provider id. The caller's rule is to exclude and log
            // rather than invent a link.
            Assert.False(CatalogVocabulary.TryGetProvider(999_999, out _));
        }
    }

    public class Building_a_badge_link
    {
        [Fact]
        public void Uses_the_service_s_own_search_template()
        {
            Assert.Equal(
                "https://www.netflix.com/search?q=Inception",
                CatalogVocabulary.DeepLinkFor(8, "Inception", "BR"));
        }

        [Fact]
        public void Url_encodes_a_title_with_spaces_and_punctuation()
        {
            // Real titles contain ampersands, colons and apostrophes; an
            // unencoded one truncates the query at the first '&' and lands the
            // visitor on the wrong page.
            var link = CatalogVocabulary.DeepLinkFor(8, "Fast & Furious: Tokyo Drift", "BR");

            Assert.Equal("https://www.netflix.com/search?q=Fast%20%26%20Furious%3A%20Tokyo%20Drift", link);
        }

        [Fact]
        public void Encodes_a_non_ascii_title()
        {
            var link = CatalogVocabulary.DeepLinkFor(8, "Cidade de Deus", "BR");

            Assert.Equal("https://www.netflix.com/search?q=Cidade%20de%20Deus", link);
        }

        [Fact]
        public void Has_no_link_for_a_service_it_cannot_name()
        {
            Assert.Null(CatalogVocabulary.DeepLinkFor(999_999, "Inception", "BR"));
        }

        [Fact]
        public void Links_a_pass_through_service_too()
        {
            // The `/search/details` path this asserted until 2026-09-28 now
            // answers 404; `/search` is what the site serves (T035).
            Assert.Equal(
                "https://pluto.tv/en/search?q=Inception",
                CatalogVocabulary.DeepLinkFor(300, "Inception", "BR"));
        }

        [Fact]
        public void Puts_the_region_in_the_path_where_a_service_wants_one()
        {
            // Paramount+ answers 200 at `/{region}/search/?q=` and drops the
            // query on the way to it from `/search/?q=`, so the region is the
            // difference between a search and an empty search box.
            Assert.Equal(
                "https://www.paramountplus.com/br/search/?q=Inception",
                CatalogVocabulary.DeepLinkFor(531, "Inception", "BR"));
        }

        [Fact]
        public void Lowercases_the_region_because_every_service_that_wants_one_does()
        {
            // Ours is stored uppercase and compared that way; theirs is `/br/`.
            // Substituting ours verbatim would produce `/BR/`, which is a
            // different page and, for Paramount+, a 404.
            Assert.Equal(
                "https://www.paramountplus.com/us/search/?q=Inception",
                CatalogVocabulary.DeepLinkFor(531, "Inception", "US"));
        }

        [Fact]
        public void Ignores_the_region_for_a_service_whose_template_has_none()
        {
            // The region is a parameter of the call, not of every link. A
            // template without the placeholder must come out identical whatever
            // region asked for it — otherwise a service could be sent a country
            // it never asked about.
            Assert.Equal(
                CatalogVocabulary.DeepLinkFor(8, "Inception", "BR"),
                CatalogVocabulary.DeepLinkFor(8, "Inception", "US"));
        }

        [Fact]
        public void Leaves_no_placeholder_unsubstituted()
        {
            // The failure this guards is quiet: an unknown placeholder ships its
            // own braces in a URL, and a mistyped `{titel}` would send every
            // visitor of that service to a search for the literal string.
            foreach (var provider in CatalogVocabulary.Providers)
            {
                var link = CatalogVocabulary.DeepLinkFor(provider.TmdbId, "Inception", "BR");

                Assert.NotNull(link);
                Assert.DoesNotContain("{", link, StringComparison.Ordinal);
            }
        }

        [Fact]
        public void Every_template_uses_only_known_placeholders()
        {
            // Asserted against the same list `DeepLinkFor` substitutes from, so
            // this cannot pass while the substitution drifts away from it.
            Assert.All(
                CatalogVocabulary.Providers,
                provider => Assert.All(
                    provider.SearchTemplate.Split('{').Skip(1),
                    fragment =>
                    {
                        var placeholder = "{" + fragment[..fragment.IndexOf('}')] + "}";

                        Assert.Contains(placeholder, CatalogVocabulary.TemplatePlaceholders);
                    }));
        }
    }

    public class The_monetization_filter
    {
        [Theory]
        [InlineData("flatrate")]
        [InlineData("free")]
        [InlineData("ads")]
        public void Counts_a_subscription_free_or_ad_supported_stream_as_available(string type)
        {
            Assert.True(CatalogVocabulary.IsStreamable(type));
        }

        [Theory]
        [InlineData("rent")]
        [InlineData("buy")]
        public void Excludes_a_transactional_offer(string type)
        {
            // The quiz asks which services the visitor *pays for* and the
            // promise is "watch tonight". A rental badge would put back the
            // dead end FR-007 exists to remove (research D5).
            Assert.False(CatalogVocabulary.IsStreamable(type));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("FREE")]        // the provider's spelling is lowercase, and
        [InlineData("subscription")] // an unknown type is not a stream we can promise
        public void Excludes_anything_not_in_the_vocabulary(string? type)
        {
            Assert.False(CatalogVocabulary.IsStreamable(type));
        }
    }

    public class The_media_type_vocabulary
    {
        [Theory]
        [InlineData(CatalogMediaType.Movie, "movie")]
        [InlineData(CatalogMediaType.Tv, "tv")]
        [InlineData(CatalogMediaType.Anime, "anime")]
        public void Round_trips_through_the_wire_name(CatalogMediaType mediaType, string wire)
        {
            // Both directions, because a stored snapshot is written in the same
            // vocabulary it is served in: a payload that read back as a
            // different value from the one written would poison a region's
            // catalog with data that looks fine until someone plays it.
            Assert.Equal(wire, CatalogMediaTypes.ToWire(mediaType));
            Assert.Equal(mediaType, CatalogMediaTypes.FromWire(wire));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("Movie")]   // the enum's own name, which the wire never uses
        [InlineData("series")]
        public void Answers_absent_for_a_name_it_does_not_know(string? wire)
        {
            // Nullable rather than throwing: the caller is reading bytes another
            // version of this code may have written, and "not one of the three"
            // is a fact the caller acts on — a snapshot whose media type is
            // unknown is not a snapshot.
            Assert.Null(CatalogMediaTypes.FromWire(wire));
        }
    }
}

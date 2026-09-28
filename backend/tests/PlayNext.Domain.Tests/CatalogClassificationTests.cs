using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The anime rule (FR-016) and title identity — the other named critical path
/// (constitution V), written before <see cref="CatalogClassification"/> had a
/// body.
///
/// The rule is a conjunction, and the tests that matter are the ones where only
/// half of it holds: a Japanese live-action film is not anime, and a French
/// cartoon is not anime. An implementation that tested "animation" alone would
/// pass the obvious case and quietly mislabel every Western animated title in
/// the pool — which is exactly the mistake the conjunction exists to prevent.
/// </summary>
public class CatalogClassificationTests
{
    private const int Animation = CatalogClassification.AnimationGenreId;

    public class The_anime_rule
    {
        [Fact]
        public void Japanese_animation_is_anime()
        {
            Assert.Equal(
                CatalogMediaType.Anime,
                CatalogClassification.ResolveMediaType(isMovie: false, [Animation, 10759], "ja"));
        }

        [Fact]
        public void Japanese_animation_that_is_a_film_is_also_anime()
        {
            // The rule overrides the underlying type in mediaType, for movies
            // as much as for series.
            Assert.Equal(
                CatalogMediaType.Anime,
                CatalogClassification.ResolveMediaType(isMovie: true, [Animation, 18], "ja"));
        }

        [Fact]
        public void Japanese_live_action_is_not_anime()
        {
            // "Seven Samurai" is Japanese, is a film, and is not animation.
            Assert.Equal(
                CatalogMediaType.Movie,
                CatalogClassification.ResolveMediaType(isMovie: true, [28, 18], "ja"));
        }

        [Fact]
        public void Animation_from_anywhere_else_is_not_anime()
        {
            // The half of the conjunction that a naive implementation drops.
            Assert.Equal(
                CatalogMediaType.Movie,
                CatalogClassification.ResolveMediaType(isMovie: true, [Animation, 10751], "en"));
        }

        [Fact]
        public void Animation_with_no_reported_language_is_not_anime()
        {
            // The provider omits original_language on some records. Absence is
            // not evidence of Japanese, so the title keeps its real type.
            Assert.Equal(
                CatalogMediaType.Tv,
                CatalogClassification.ResolveMediaType(isMovie: false, [Animation], null));
        }

        [Fact]
        public void A_non_japanese_title_with_no_genres_is_not_anime()
        {
            Assert.Equal(
                CatalogMediaType.Movie,
                CatalogClassification.ResolveMediaType(isMovie: true, [], "ja"));
        }

        [Fact]
        public void Compares_the_language_code_case_insensitively()
        {
            // TMDB spells it lowercase; a defensive comparison costs nothing and
            // an uppercase variant must not silently un-classify a title.
            Assert.Equal(
                CatalogMediaType.Anime,
                CatalogClassification.ResolveMediaType(isMovie: false, [Animation], "JA"));
        }
    }

    public class Title_identity
    {
        [Fact]
        public void Carries_the_underlying_type_for_a_movie()
        {
            Assert.Equal("tmdb:movie:27205", CatalogClassification.BuildTitleId(isMovie: true, 27205));
        }

        [Fact]
        public void Carries_the_underlying_type_for_a_series()
        {
            Assert.Equal("tmdb:tv:1396", CatalogClassification.BuildTitleId(isMovie: false, 1396));
        }

        [Fact]
        public void Does_not_carry_the_anime_classification()
        {
            // Identity is stable even if the classification rule is revisited:
            // an anime's id names the type the provider actually filed it under
            // (research D9). Asserted by construction — the id is built from the
            // underlying type alone, with no mediaType argument to pass.
            var id = CatalogClassification.BuildTitleId(isMovie: false, 1429);

            Assert.DoesNotContain("anime", id, StringComparison.Ordinal);
            Assert.StartsWith("tmdb:tv:", id, StringComparison.Ordinal);
        }

        [Fact]
        public void Distinguishes_a_movie_from_a_series_with_the_same_number()
        {
            // TMDB ids collide only across types, which is why the type is part
            // of the id rather than a separate column.
            Assert.NotEqual(
                CatalogClassification.BuildTitleId(isMovie: true, 1399),
                CatalogClassification.BuildTitleId(isMovie: false, 1399));
        }
    }

    public class The_media_type_vocabulary
    {
        [Theory]
        [InlineData(CatalogMediaType.Movie, "movie")]
        [InlineData(CatalogMediaType.Tv, "tv")]
        [InlineData(CatalogMediaType.Anime, "anime")]
        public void Matches_the_three_the_quiz_already_offers(CatalogMediaType mediaType, string wire)
        {
            // These three strings are the client's own vocabulary — the quiz
            // offers them and 002 stores them. The server must not invent a
            // fourth spelling.
            Assert.Equal(wire, CatalogMediaTypes.ToWire(mediaType));
        }
    }
}

using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The refresh plan (research D2): what a normalized refresh asks the provider
/// for, in what order, and how deep.
///
/// The plan is the difference between the old sample and a deep pool, so the
/// tests pin the shape rather than a particular run: nine genres × two
/// presentation media types per service, a separate anime stream per genre plus
/// an any-genre one, and the general slice unchanged from 005. A plan that
/// silently lost the anime streams, or forgot that one service has two provider
/// ids, would still "work" — it would just return a shallower catalog.
/// </summary>
public class CatalogSliceTests
{
    private const int Animation = CatalogClassification.AnimationGenreId;

    private static readonly CatalogSlicePlanOptions Options = new(
        GeneralMoviesPerGenre: 10,
        GeneralTvPerGenre: 11,
        GeneralAnimeQuota: 12,
        ServiceTitlesPerGenre: 300,
        MaxDiscoverPages: 25);

    public class The_slice_list
    {
        [Fact]
        public void General_comes_first_then_one_slice_for_each_quiz_service()
        {
            var slices = CatalogSlicePlan.Build(Options);

            Assert.Equal(CatalogSlicePlan.QuizServices.Count + 1, slices.Count);
            Assert.True(slices[0].IsGeneral);
            Assert.Equal(CatalogSlicePlan.GeneralSliceName, slices[0].Name);
            Assert.Equal(
                new[]
                {
                    "netflix",
                    "prime-video",
                    "disney-plus",
                    "max",
                    "apple-tv-plus",
                    "paramount-plus",
                    "crunchyroll",
                    "mubi",
                    "globoplay",
                    "hulu",
                    "peacock",
                },
                slices.Skip(1).Select(slice => slice.ServiceId).ToList());
        }

        [Fact]
        public void Every_service_slice_is_identified_by_its_service_and_flagged_as_quiz_owned()
        {
            foreach (var slice in CatalogSlicePlan.Build(Options).Skip(1))
            {
                Assert.False(slice.IsGeneral);
                Assert.True(slice.IsQuizService);
                Assert.Equal(slice.ServiceId, slice.Name);
                Assert.NotEmpty(slice.ProviderIds);

                // Every provider id on a slice must resolve back to the same
                // service: a typo in a provider id would otherwise send the
                // query to a service that does not exist and quietly return
                // nothing.
                foreach (var providerId in slice.ProviderIds)
                {
                    Assert.True(CatalogVocabulary.TryGetProvider(providerId, out var provider));
                    Assert.Equal(slice.ServiceId, provider.ProviderId);
                }
            }
        }

        [Fact]
        public void The_general_slice_is_not_a_quiz_service()
        {
            var general = CatalogSlicePlan.Build(Options)[0];

            Assert.Null(general.ServiceId);
            Assert.False(general.IsQuizService);
            Assert.Empty(general.ProviderIds);
        }
    }

    public class The_general_slice
    {
        [Fact]
        public void Is_nine_genres_times_movie_and_tv_plus_the_two_anime_streams()
        {
            var general = CatalogSlicePlan.Build(Options)[0];

            Assert.Equal((CatalogVocabulary.GenreIds.Count * 2) + 2, general.Queries.Count);

            var index = 0;

            foreach (var genreId in CatalogVocabulary.GenreIds)
            {
                var movie = general.Queries[index++];
                var tv = general.Queries[index++];

                Assert.True(movie.IsMovie);
                Assert.False(tv.IsMovie);
                Assert.Equal(new[] { genreId }, movie.GenreIds);
                Assert.Equal(new[] { genreId }, tv.GenreIds);
                Assert.Null(movie.OriginalLanguage);
                Assert.Null(tv.OriginalLanguage);
            }

            var animeMovie = general.Queries[index++];
            var animeTv = general.Queries[index];

            Assert.True(animeMovie.IsMovie);
            Assert.False(animeTv.IsMovie);
            Assert.Equal(new[] { Animation }, animeMovie.GenreIds);
            Assert.Equal(new[] { Animation }, animeTv.GenreIds);
            Assert.Equal(CatalogClassification.JapaneseLanguage, animeMovie.OriginalLanguage);
            Assert.Equal(CatalogClassification.JapaneseLanguage, animeTv.OriginalLanguage);
        }

        [Fact]
        public void Uses_the_three_general_targets_rather_than_the_service_depth()
        {
            var general = CatalogSlicePlan.Build(Options)[0];

            // Targets 10, 11 and 12 are all distinct, so this catches a build
            // that picked the wrong option — a shared number would hide it.
            Assert.All(
                general.Queries.Where(query => query.GenreIds.Count == 1 && query.OriginalLanguage is null),
                query => Assert.Equal(
                    query.IsMovie ? Options.GeneralMoviesPerGenre : Options.GeneralTvPerGenre,
                    query.Target));
            Assert.All(
                general.Queries.Where(query => query.OriginalLanguage is not null),
                query => Assert.Equal(Options.GeneralAnimeQuota, query.Target));
        }
    }

    public class A_service_slice
    {
        [Fact]
        public void Is_nine_genres_twice_then_per_genre_anime_then_any_genre_anime()
        {
            var slice = CatalogSlicePlan.Build(Options).First(candidate => candidate.ServiceId == "netflix");

            // 9 × 2 discovery queries, 8 × 2 per-genre anime (animation itself
            // is skipped), and 2 any-genre anime queries.
            Assert.Equal((CatalogVocabulary.GenreIds.Count * 2) + ((CatalogVocabulary.GenreIds.Count - 1) * 2) + 2,
                slice.Queries.Count);
        }

        [Fact]
        public void The_genre_queries_keep_the_vocabulary_order_and_alternate_movie_then_tv()
        {
            var slice = CatalogSlicePlan.Build(Options).First(candidate => candidate.ServiceId == "netflix");
            var index = 0;

            foreach (var genreId in CatalogVocabulary.GenreIds)
            {
                var movie = slice.Queries[index++];
                var tv = slice.Queries[index++];

                // Anime is a classification, not a discovery type, so every
                // genre query asks for both provider types without a language
                // filter.
                Assert.True(movie.IsMovie);
                Assert.False(tv.IsMovie);
                Assert.Equal(new[] { genreId }, movie.GenreIds);
                Assert.Equal(new[] { genreId }, tv.GenreIds);
                Assert.Null(movie.OriginalLanguage);
                Assert.Null(tv.OriginalLanguage);
            }
        }

        [Fact]
        public void Every_further_query_is_a_japanese_animation_stream()
        {
            var slice = CatalogSlicePlan.Build(Options).First(candidate => candidate.ServiceId == "netflix");

            foreach (var query in slice.Queries.Skip(CatalogVocabulary.GenreIds.Count * 2))
            {
                Assert.Equal(CatalogClassification.JapaneseLanguage, query.OriginalLanguage);
                Assert.Equal(Animation, query.GenreIds[0]);
            }
        }

        [Fact]
        public void The_per_genre_anime_streams_include_the_genre_and_skip_animation_itself()
        {
            var slice = CatalogSlicePlan.Build(Options).First(candidate => candidate.ServiceId == "netflix");
            var animeQueries = slice
                .Queries
                .Skip(CatalogVocabulary.GenreIds.Count * 2)
                .Where(query => query.GenreIds.Count == 2)
                .ToList();

            Assert.Equal((CatalogVocabulary.GenreIds.Count - 1) * 2, animeQueries.Count);

            foreach (var genreId in CatalogVocabulary.GenreIds.Where(id => id != Animation))
            {
                Assert.Equal(
                    2,
                    animeQueries.Count(query => query.GenreIds.SequenceEqual([Animation, genreId])));
            }

            // [animation, animation] would be a duplicate of the any-genre
            // stream, wasting a whole query and paging twice over the same
            // results.
            Assert.DoesNotContain(animeQueries, query => query.GenreIds.Distinct().Count() != 2);
        }

        [Fact]
        public void Ends_with_the_two_any_genre_anime_streams()
        {
            var slice = CatalogSlicePlan.Build(Options).First(candidate => candidate.ServiceId == "netflix");
            var tail = slice.Queries.TakeLast(2).ToList();

            Assert.True(tail[0].IsMovie);
            Assert.False(tail[1].IsMovie);
            Assert.Equal(new[] { Animation }, tail[0].GenreIds);
            Assert.Equal(new[] { Animation }, tail[1].GenreIds);
            Assert.Equal(CatalogClassification.JapaneseLanguage, tail[0].OriginalLanguage);
            Assert.Equal(CatalogClassification.JapaneseLanguage, tail[1].OriginalLanguage);
        }

        [Fact]
        public void Uses_the_service_depth_for_every_query()
        {
            var slice = CatalogSlicePlan.Build(Options).First(candidate => candidate.ServiceId == "max");

            Assert.All(slice.Queries, query => Assert.Equal(Options.ServiceTitlesPerGenre, query.Target));
        }
    }

    public class Provider_aliases
    {
        [Fact]
        public void A_service_with_a_second_provider_id_filters_for_both_at_once()
        {
            var slices = CatalogSlicePlan.Build(Options);

            // Netflix lists an ad-supported tier under 1796 and Prime Video
            // under 2100. Discovery must ask for both, or half of what the
            // service actually carries is invisible.
            Assert.Equal(new[] { 8, 1796 }, slices.First(slice => slice.ServiceId == "netflix").ProviderIds);
            Assert.Equal(new[] { 119, 2100 }, slices.First(slice => slice.ServiceId == "prime-video").ProviderIds);

            foreach (var service in new[] { "disney-plus", "max", "apple-tv-plus", "paramount-plus", "crunchyroll", "mubi", "globoplay", "hulu", "peacock" })
            {
                Assert.Single(slices.First(slice => slice.ServiceId == service).ProviderIds);
            }
        }

        [Fact]
        public void There_is_one_slice_per_service_not_one_per_provider_id()
        {
            var serviceIds = CatalogSlicePlan.Build(Options)
                .Where(slice => slice.IsQuizService)
                .Select(slice => slice.ServiceId)
                .ToList();

            Assert.Equal(serviceIds.Count, serviceIds.Distinct(StringComparer.Ordinal).Count());
        }
    }

    public class The_paging_cap
    {
        [Fact]
        public void Applies_to_every_slice_and_every_query()
        {
            foreach (var slice in CatalogSlicePlan.Build(Options))
            {
                Assert.Equal(Options.MaxDiscoverPages, slice.MaxPages);
                Assert.All(slice.Queries, query => Assert.InRange(query.Target, 1, int.MaxValue));
            }
        }

        [Fact]
        public void Is_read_from_the_options_rather_than_hard_coded()
        {
            var slices = CatalogSlicePlan.Build(Options with { MaxDiscoverPages = 7 });

            Assert.All(slices, slice => Assert.Equal(7, slice.MaxPages));
        }
    }

    public class Discovery_dedupe
    {
        [Fact]
        public void A_title_reached_through_several_queries_is_kept_once_in_first_seen_order()
        {
            var first = new CatalogCandidate("tmdb:movie:1", IsMovie: true, TmdbId: 1, Popularity: 10);
            var second = new CatalogCandidate("tmdb:movie:2", IsMovie: true, TmdbId: 2, Popularity: 20);
            var repeatedEarlier = new CatalogCandidate("tmdb:movie:1", IsMovie: true, TmdbId: 1, Popularity: 99);

            var distinct = CatalogDiscoveryOrder.Distinct([first, second, repeatedEarlier]);

            Assert.Equal(new[] { "tmdb:movie:1", "tmdb:movie:2" }, distinct.Select(candidate => candidate.TitleId).ToList());

            // The first occurrence owns the record: a later query's copy must
            // not overwrite the popularity that orders the pool.
            Assert.Equal(10, distinct[0].Popularity);
        }

        [Fact]
        public void Movie_and_tv_ids_are_different_titles()
        {
            // tmdb:movie:1 and tmdb:tv:1 are the provider's two separate
            // records for number 1, not one title seen twice.
            var distinct = CatalogDiscoveryOrder.Distinct([
                new CatalogCandidate("tmdb:movie:1", IsMovie: true, TmdbId: 1, Popularity: 1),
                new CatalogCandidate("tmdb:tv:1", IsMovie: false, TmdbId: 1, Popularity: 1),
            ]);

            Assert.Equal(2, distinct.Count);
        }
    }
}

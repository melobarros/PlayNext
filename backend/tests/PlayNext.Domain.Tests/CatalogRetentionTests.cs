using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The retention rules (research D5).
///
/// The provider's terms cap carriage data at six months, so every observation
/// has a deadline. The boundary tests are the point of this suite: a row exactly
/// at the cutoff is still within the limit, and a version with nothing observed
/// at all is expired rather than eternal. An off-by-one here decides whether a
/// catalog serves stale data past what the terms allow.
/// </summary>
public class CatalogRetentionTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 12, 0, 0, TimeSpan.Zero);

    public class The_limit
    {
        [Fact]
        public void Is_six_months()
        {
            Assert.Equal(TimeSpan.FromDays(180), CatalogRetention.Limit);
        }

        [Fact]
        public void The_cutoff_is_the_limit_before_now()
        {
            Assert.Equal(Now - TimeSpan.FromDays(180), CatalogRetention.Cutoff(Now));
        }
    }

    public class A_row_observation
    {
        [Fact]
        public void One_tick_before_the_cutoff_has_expired()
        {
            Assert.True(CatalogRetention.IsExpired(CatalogRetention.Cutoff(Now).AddTicks(-1), Now));
        }

        [Fact]
        public void Exactly_at_the_cutoff_has_not_expired()
        {
            // "<" rather than "<=": the rule is "older than six months", and a
            // row observed six months ago to the tick is not older than that.
            Assert.False(CatalogRetention.IsExpired(CatalogRetention.Cutoff(Now), Now));
        }

        [Fact]
        public void Inside_the_limit_has_not_expired()
        {
            Assert.False(CatalogRetention.IsExpired(Now.AddDays(-179), Now));
            Assert.False(CatalogRetention.IsExpired(Now, Now));
        }

        [Fact]
        public void After_the_limit_has_expired()
        {
            Assert.True(CatalogRetention.IsExpired(Now.AddDays(-181), Now));
            Assert.True(CatalogRetention.IsExpired(Now.AddYears(-2), Now));
        }
    }

    public class A_version
    {
        [Fact]
        public void With_no_observation_at_all_is_expired()
        {
            // A version whose rows were all purged can prove nothing recent,
            // so it is treated as expired rather than as fresh forever.
            Assert.True(CatalogRetention.IsVersionExpired(null, Now));
        }

        [Fact]
        public void Is_expired_when_its_newest_observation_is_before_the_cutoff()
        {
            Assert.True(CatalogRetention.IsVersionExpired(CatalogRetention.Cutoff(Now).AddTicks(-1), Now));
            Assert.True(CatalogRetention.IsVersionExpired(Now.AddDays(-400), Now));
        }

        [Fact]
        public void Is_not_expired_when_any_observation_is_inside_the_limit()
        {
            Assert.False(CatalogRetention.IsVersionExpired(CatalogRetention.Cutoff(Now), Now));
            Assert.False(CatalogRetention.IsVersionExpired(Now.AddMinutes(-1), Now));
        }
    }

    public class Archiving
    {
        [Fact]
        public void A_title_a_user_record_references_is_archived()
        {
            Assert.True(CatalogRetention.ShouldArchive(referencedByUserRecord: true));
        }

        [Fact]
        public void An_unreferenced_title_is_simply_deleted()
        {
            Assert.False(CatalogRetention.ShouldArchive(referencedByUserRecord: false));
        }
    }

    public class The_latest_observation
    {
        [Fact]
        public void Is_null_when_a_version_has_no_rows_left()
        {
            Assert.Null(CatalogRetention.LatestObservedAt([]));
        }

        [Fact]
        public void Is_the_newest_of_the_rows()
        {
            Assert.Equal(
                Now,
                CatalogRetention.LatestObservedAt([Now.AddDays(-10), Now, Now.AddDays(-3)]));
        }

        [Fact]
        public void Is_the_only_row_when_there_is_one()
        {
            Assert.Equal(Now, CatalogRetention.LatestObservedAt([Now]));
        }
    }
}

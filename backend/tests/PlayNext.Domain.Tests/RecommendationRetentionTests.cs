using PlayNext.Domain;

namespace PlayNext.Domain.Tests;

/// <summary>
/// The 90-day behavioral-event rule (FR-018, research D14).
///
/// The boundary is the point of this suite in the same way it is for the
/// catalog ceiling: an event exactly at the cutoff is still within the window,
/// because the rule is "older than 90 days", not "90 days old". An off-by-one
/// here changes what the product promises about visitor data.
/// </summary>
public class RecommendationRetentionTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 12, 0, 0, TimeSpan.Zero);

    public class The_limit
    {
        [Fact]
        public void Is_ninety_days()
        {
            Assert.Equal(TimeSpan.FromDays(90), RecommendationRetention.Limit);
        }

        [Fact]
        public void The_cutoff_is_the_limit_before_now()
        {
            Assert.Equal(Now - TimeSpan.FromDays(90), RecommendationRetention.Cutoff(Now));
        }
    }

    public class An_event
    {
        [Fact]
        public void One_tick_before_the_cutoff_has_expired()
        {
            Assert.True(
                RecommendationRetention.IsExpired(
                    RecommendationRetention.Cutoff(Now).AddTicks(-1),
                    Now));
        }

        [Fact]
        public void Exactly_at_the_cutoff_has_not_expired()
        {
            Assert.False(RecommendationRetention.IsExpired(RecommendationRetention.Cutoff(Now), Now));
        }

        [Fact]
        public void Inside_the_window_has_not_expired()
        {
            Assert.False(RecommendationRetention.IsExpired(Now.AddDays(-89), Now));
            Assert.False(RecommendationRetention.IsExpired(Now, Now));
        }

        [Fact]
        public void Past_the_window_has_expired()
        {
            Assert.True(RecommendationRetention.IsExpired(Now.AddDays(-91), Now));
            Assert.True(RecommendationRetention.IsExpired(Now.AddYears(-2), Now));
        }
    }

    public class The_action_vocabulary
    {
        [Fact]
        public void Has_exactly_the_five_spec_kinds()
        {
            Assert.Equal(
                ["liked", "disliked", "skip", "watch_now", "undo"],
                RecommendationActionKinds.All);
        }

        [Theory]
        [InlineData("liked")]
        [InlineData("disliked")]
        [InlineData("skip")]
        [InlineData("watch_now")]
        [InlineData("undo")]
        public void Accepts_a_wire_kind(string kind)
        {
            Assert.True(RecommendationActionKinds.IsKnown(kind));
        }

        [Theory]
        [InlineData("loved")]
        [InlineData("Liked")]
        [InlineData("watch-now")]
        [InlineData("watchNow")]
        [InlineData("")]
        [InlineData(null)]
        public void Rejects_anything_outside_the_vocabulary(string? kind)
        {
            Assert.False(RecommendationActionKinds.IsKnown(kind));
        }
    }
}

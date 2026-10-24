using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// The recommendation-event purge (T053, FR-018, research D14).
///
/// The intake tests prove the rows get in; these prove the old ones leave, and
/// that leaving takes nothing else with them. The window is a promise about how
/// long the product keeps a visitor's behaviour, so the assertions are made
/// against the database — a purge that reported a number without deleting, or
/// that took an account's ratings with it, would pass every unit test in the
/// Application project.
///
/// Rows are seeded directly, not through the endpoint: the endpoint stamps
/// <c>ReceivedAt</c> with the server's clock, and the whole subject here is what
/// happens to *old* receipts.
/// </summary>
public sealed class RecommendationRetentionTests : IClassFixture<AuthApiFactory>
{
    private static readonly DateTimeOffset CatalogVersion =
        DateTimeOffset.Parse("2026-10-24T17:07:32.000Z", CultureInfo.InvariantCulture);

    private readonly AuthApiFactory _api;

    public RecommendationRetentionTests(AuthApiFactory api) => _api = api;

    private static DbContextOptions<AppDbContext> DbOptions() =>
        new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(Postgres.ConnectionString)
            .Options;

    /// <summary>A session id no other test has used, which is also its row filter.</summary>
    private static string NewSession() => Guid.NewGuid().ToString();

    private static RecommendationImpression Impression(string sessionId, DateTimeOffset receivedAt) =>
        new()
        {
            ClientEventId = Guid.NewGuid(),
            SessionId = sessionId,
            TitleId = "arrival",
            Surface = "deck",
            Position = 1,
            EngineVersion = "recommend-v1",
            CatalogVersion = CatalogVersion,
            FilterHash = "0123456789abcdef",
            Score = 7.5,
            ReasonCode = "none",
            ShownAt = receivedAt.AddSeconds(-2),
            ReceivedAt = receivedAt,
        };

    /// <summary>Seeds one impression and one action, both received at <paramref name="receivedAt"/>.</summary>
    private static async Task<(long ImpressionId, long ActionId)> SeedAsync(DateTimeOffset receivedAt)
    {
        await using var db = new AppDbContext(DbOptions());

        var impression = Impression(NewSession(), receivedAt);

        db.RecommendationImpressions.Add(impression);
        await db.SaveChangesAsync();

        var action = new RecommendationAction
        {
            ClientEventId = Guid.NewGuid(),
            ImpressionId = impression.Id,
            Kind = "liked",
            DwellMs = 1_200,
            OccurredAt = receivedAt,
            ReceivedAt = receivedAt,
        };

        db.RecommendationActions.Add(action);
        await db.SaveChangesAsync();

        return (impression.Id, action.Id);
    }

    /// <summary>The store, against the real database and without a host.</summary>
    private static async Task<int> PurgeAsync(DateTimeOffset cutoff)
    {
        await using var db = new AppDbContext(DbOptions());

        return await new RecommendationRetentionStore(db).PurgeAsync(cutoff, CancellationToken.None);
    }

    [GatedFact]
    public async Task The_purge_deletes_events_past_the_window_and_keeps_the_rest()
    {
        var now = DateTimeOffset.UtcNow;

        var expired = await SeedAsync(now - RecommendationRetention.Limit - TimeSpan.FromDays(1));
        var kept = await SeedAsync(now - RecommendationRetention.Limit + TimeSpan.FromDays(1));

        // Resolved from the host rather than constructed here: this is the one
        // test that proves the purge the application would actually run is the
        // one that works.
        using (var scope = _api.Services.CreateScope())
        {
            await scope.ServiceProvider
                .GetRequiredService<PurgeRecommendationEventsUseCase>()
                .PurgeAsync(CancellationToken.None);
        }

        await using var db = new AppDbContext(DbOptions());

        Assert.False(await db.RecommendationImpressions.AnyAsync(row => row.Id == expired.ImpressionId));

        // The action went with it, by the foreign key's cascade. Without that,
        // ninety days of responses would outlive the cards they answer forever.
        Assert.False(await db.RecommendationActions.AnyAsync(row => row.Id == expired.ActionId));

        Assert.True(await db.RecommendationImpressions.AnyAsync(row => row.Id == kept.ImpressionId));
        Assert.True(await db.RecommendationActions.AnyAsync(row => row.Id == kept.ActionId));
    }

    [GatedFact]
    public async Task Keeps_an_event_received_exactly_at_the_cutoff()
    {
        // The rule is "older than ninety days", not "ninety days old", so the
        // boundary is kept. The cutoff here is deliberately synthetic (a day
        // ahead): the boundary is a property of the comparison, not of today's
        // date, and a cutoff near now would let another test host's startup
        // purge delete the row and turn a deterministic test into a race.
        var cutoff = DateTimeOffset.UtcNow.AddDays(1);

        var atBoundary = await SeedAsync(cutoff);
        var justPast = await SeedAsync(cutoff.AddSeconds(-1));

        var deleted = await PurgeAsync(cutoff);

        Assert.True(deleted >= 1);

        await using var db = new AppDbContext(DbOptions());

        Assert.False(await db.RecommendationImpressions.AnyAsync(row => row.Id == justPast.ImpressionId));
        Assert.True(await db.RecommendationImpressions.AnyAsync(row => row.Id == atBoundary.ImpressionId));

        // It is younger than any real purge would consider, so remove it here
        // rather than leave a row for a background pass ninety days from now.
        await db.RecommendationImpressions
            .Where(row => row.Id == atBoundary.ImpressionId)
            .ExecuteDeleteAsync();
    }

    [GatedFact]
    public async Task A_second_purge_deletes_nothing()
    {
        var cutoff = DateTimeOffset.UtcNow - RecommendationRetention.Limit;

        // Drains whatever an earlier test left expired, so the pass below
        // starts from an empty backlog.
        await PurgeAsync(cutoff);

        var seeded = await SeedAsync(cutoff.AddDays(-2));

        await PurgeAsync(cutoff);

        // The row is gone — by this pass or by a test host's own startup pass
        // running beside it. Both are the purge doing its job, so the count is
        // not asserted; that number would be a race between the two, and the
        // row's fate is what the product promised.
        await using var db = new AppDbContext(DbOptions());

        Assert.False(await db.RecommendationImpressions.AnyAsync(row => row.Id == seeded.ImpressionId));

        // With the backlog now empty, a second pass over the same cutoff finds
        // nothing to do — a purge that kept finding the same rows would be one
        // that never deleted them.
        Assert.Equal(0, await PurgeAsync(cutoff));
    }

    [GatedFact]
    public async Task The_startup_pass_purges_without_being_asked()
    {
        // FR-018's "runs daily" is only true if the host actually runs it, and
        // on a scale-to-zero host the pass that matters is the one at start.
        // This drives a real host of its own — the class fixture's may already
        // have started, and a started host does not purge a second time.
        var expired = await SeedAsync(
            DateTimeOffset.UtcNow - RecommendationRetention.Limit - TimeSpan.FromDays(1));

        await using var host = new AuthApiFactory();

        // Starting the host is the whole trigger: no purge is called here.
        using (var scope = host.Services.CreateScope())
        {
            _ = scope.ServiceProvider;
        }

        await using var db = new AppDbContext(DbOptions());

        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);

        while (await db.RecommendationImpressions.AnyAsync(row => row.Id == expired.ImpressionId))
        {
            Assert.True(
                DateTimeOffset.UtcNow < deadline,
                "the host's startup retention pass never deleted the expired impression");

            await Task.Delay(100);
        }
    }

    [GatedFact]
    public async Task The_purge_takes_nothing_outside_the_telemetry_tables()
    {
        // The two tables are an observation log; the account's own records are
        // the product's state. A purge that harvested whole sessions, or that
        // deleted an interaction because it shared a title id with an expired
        // impression, would show up here and nowhere else.
        var email = $"{Guid.NewGuid():N}@example.test";

        var registration = await _api.CreateClient().PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
        });

        Assert.Equal(HttpStatusCode.OK, registration.StatusCode);

        Guid userId;

        await using (var seeding = new AppDbContext(DbOptions()))
        {
            userId = (await seeding.Users.SingleAsync(user => user.Email == email)).Id;

            seeding.Interactions.Add(new UserInteraction
            {
                UserId = userId,
                TitleId = "arrival",
                State = InteractionState.Liked,
                UpdatedAt = DateTimeOffset.UtcNow,
            });

            seeding.Preferences.Add(new UserPreference
            {
                UserId = userId,
                CompletedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });

            await seeding.SaveChangesAsync();
        }

        await SeedAsync(DateTimeOffset.UtcNow - RecommendationRetention.Limit - TimeSpan.FromDays(1));

        await PurgeAsync(DateTimeOffset.UtcNow - RecommendationRetention.Limit);

        await using var db = new AppDbContext(DbOptions());

        Assert.True(await db.Interactions.AnyAsync(row => row.UserId == userId));
        Assert.True(await db.Preferences.AnyAsync(row => row.UserId == userId));
    }
}

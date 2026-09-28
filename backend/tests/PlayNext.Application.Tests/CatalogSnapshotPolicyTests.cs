using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Domain;

namespace PlayNext.Application.Tests;

/// <summary>
/// The snapshot cache policy (T026, US3, FR-004/FR-012/FR-013/FR-014).
///
/// The constitution names this as one of 005's two critical paths, and it is
/// worth saying why: every requirement here is about a *failure*, and a failure
/// is precisely the state nobody looks at while building the happy path. A
/// snapshot that ages out, a batch that dies half-way, ten visitors arriving at
/// a cold region at once — each has an obvious-looking wrong answer that passes
/// every test written from the happy path, and each wrong answer ends with the
/// visitor staring at an empty deck while the server believes it succeeded.
///
/// So the assertions are about what is *not* done: what a failed batch does not
/// write, what a stale snapshot does not cost the visitor, and how many times
/// the provider is asked.
///
/// **What this file cannot reach, and where it is settled instead.** The port
/// hides two levels — a memory cache in front of a durable row (research D10) —
/// so "the failed batch wrote nothing to L1 *or* L2" is not expressible here;
/// what is expressible is the invariant the port owes the policy: a failed
/// refresh calls <see cref="ICatalogSnapshotStore.SaveAsync"/> not at all. That
/// the same is true of both real levels, and that a snapshot survives the
/// process that wrote it, is asserted in <c>CatalogOutageTests</c> against the
/// running host, where both levels actually exist.
///
/// Single-flight is the other half of that split. The policy's part in it is
/// that the request path never runs a batch itself — it hands the start to
/// <see cref="ICatalogRefresher"/> and answers. Ten concurrent arrivals
/// producing one batch is the refresher's guarantee, and it is asserted in
/// <c>CatalogOutageTests</c> where the real refresher is running.
/// </summary>
public class CatalogSnapshotPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The bound every case below moves the clock across.</summary>
    private static readonly TimeSpan Staleness = TimeSpan.FromHours(24);

    private static CatalogTitle Title(string id) =>
        new(
            id,
            "A Title",
            2010,
            CatalogMediaType.Movie,
            ["action"],
            "A synopsis.",
            8.4,
            36_000,
            148,
            null,
            null,
            [new StreamingAvailability("netflix", "https://www.netflix.com/search?q=A+Title")]);

    /// <summary>
    /// A clock the test sets, rather than a real one it races.
    ///
    /// Staleness is a comparison between two instants, and the only way to test
    /// the wrong side of a 24-hour boundary without waiting a day is to move the
    /// clock. <see cref="TimeProvider"/> is the seam that makes that possible
    /// without the policy knowing it is being tested.
    /// </summary>
    private sealed class TestClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    /// <summary>The provider, canned: it returns what it is told to, or fails.</summary>
    private sealed class CannedProvider : ICatalogProvider
    {
        public IReadOnlyList<CatalogTitle> Titles { get; set; } = [Title("tmdb:movie:1")];

        public Exception? Fails { get; set; }

        /// <summary>How many batches were run. The request path must leave this at zero.</summary>
        public int Fetches { get; private set; }

        public Task<IReadOnlyList<CatalogTitle>> FetchAsync(string region, CancellationToken cancellationToken)
        {
            Fetches++;

            return Fails is { } failure
                ? Task.FromException<IReadOnlyList<CatalogTitle>>(failure)
                : Task.FromResult(Titles);
        }
    }

    /// <summary>
    /// The store, as one level, recording every write.
    ///
    /// One level rather than two on purpose: the policy is not allowed to know
    /// there are two, and a fake that modelled them would be testing an
    /// implementation it is not supposed to depend on.
    /// </summary>
    private sealed class RecordingStore : ICatalogSnapshotStore
    {
        private readonly Dictionary<string, CatalogSnapshot> _regions = new(StringComparer.Ordinal);

        public List<CatalogSnapshot> Saves { get; } = [];

        /// <summary>What the store currently holds for a region — after any writes.</summary>
        public CatalogSnapshot? Held(string region) => _regions.GetValueOrDefault(region);

        public Task<CatalogSnapshot?> LoadAsync(string region, CancellationToken cancellationToken) =>
            Task.FromResult(Held(region));

        public Task SaveAsync(CatalogSnapshot snapshot, CancellationToken cancellationToken)
        {
            Saves.Add(snapshot);
            _regions[snapshot.Region] = snapshot;

            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// The refresher, counting starts and running nothing.
    ///
    /// It deliberately does not run the batch: a fake that did would blur the
    /// one distinction these tests turn on — that the request path *starts*
    /// retrievals and never performs them.
    /// </summary>
    private sealed class CountingRefresher : ICatalogRefresher
    {
        public List<string> Started { get; } = [];

        public bool TryStart(string region)
        {
            Started.Add(region);

            return true;
        }

        public bool IsRunning(string region) => false;
    }

    private sealed class Harness
    {
        public CannedProvider Provider { get; } = new();

        public RecordingStore Store { get; } = new();

        public CountingRefresher Refresher { get; } = new();

        public TestClock Clock { get; } = new(Now);

        public CatalogUseCases UseCases => new(Provider, Store, Refresher, Clock, Staleness);

        public Task<CatalogResult> Get(string region = "BR") =>
            UseCases.GetAsync(region, CancellationToken.None);

        public Task Refresh(string region = "BR") =>
            UseCases.RefreshAsync(region, CancellationToken.None);

        /// <summary>Puts a snapshot in the store as though it were retrieved at an earlier instant.</summary>
        public Harness Holding(DateTimeOffset fetchedAt, params CatalogTitle[] titles)
        {
            Store.SaveAsync(new CatalogSnapshot("BR", fetchedAt, titles), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            Store.Saves.Clear();

            return this;
        }
    }

    public class ServingWhatIsStored
    {
        [Fact]
        public async Task A_fresh_snapshot_is_served_without_asking_the_provider()
        {
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(1), Title("tmdb:movie:27205"));

            var result = await harness.Get();

            Assert.True(result.IsReady);
            Assert.Equal("tmdb:movie:27205", Assert.Single(result.Snapshot!.Titles).Id);

            // The whole point of the cache: a visitor's request never waits on
            // the provider, and never causes work the provider would have to do
            // twice for the rest of the region (research D10).
            Assert.Equal(0, harness.Provider.Fetches);
            Assert.Empty(harness.Refresher.Started);
        }

        [Fact]
        public async Task Nothing_ever_stored_is_answered_not_ready_and_starts_a_retrieval()
        {
            // FR-014: the honest "nothing yet, working on it" rather than an
            // empty catalog, which the client would cache as though it were the
            // catalog itself (research D11).
            var harness = new Harness();

            var result = await harness.Get();

            Assert.False(result.IsReady);
            Assert.Null(result.Snapshot);
            Assert.Equal(["BR"], harness.Refresher.Started);

            // Started, not awaited. A request that ran the batch would be a
            // spinner for the length of several hundred upstream calls.
            Assert.Equal(0, harness.Provider.Fetches);
        }
    }

    public class TheStalenessBound
    {
        [Fact]
        public async Task A_stale_snapshot_is_still_served()
        {
            // FR-012, and the reason the bound is not an expiry: a catalog from
            // yesterday is a better answer than no catalog, and the visitor has
            // no way to act on the difference.
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(25), Title("tmdb:movie:27205"));

            var result = await harness.Get();

            Assert.True(result.IsReady);
            Assert.Equal("tmdb:movie:27205", Assert.Single(result.Snapshot!.Titles).Id);
        }

        [Fact]
        public async Task A_stale_snapshot_starts_a_retrieval_behind_the_response()
        {
            // FR-004: staleness bounds freshness, not availability. The refresh
            // happens *behind* the response — this call has already returned by
            // the time the batch is running.
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(25));

            await harness.Get();

            Assert.Equal(["BR"], harness.Refresher.Started);
        }

        [Fact]
        public async Task A_stale_snapshot_never_waits_for_the_retrieval()
        {
            // The same rule as the cold case, one state later: the visitor who
            // arrives to a stale catalog waits for a cache read, not for a
            // twenty-five second batch (research D10, SC-002).
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(25));

            await harness.Get();

            Assert.Equal(0, harness.Provider.Fetches);
        }

        [Fact]
        public async Task A_snapshot_exactly_at_the_bound_is_not_yet_stale()
        {
            // The boundary is `age > bound`, not `age >= bound`. Worth pinning
            // because the difference is invisible in every other test and
            // decides whether a snapshot retrieved exactly 24 hours ago is
            // refreshed on this request or the next.
            var harness = new Harness().Holding(Now - Staleness);

            await harness.Get();

            Assert.Empty(harness.Refresher.Started);
        }
    }

    public class TheAtomicSwap
    {
        [Fact]
        public async Task A_failed_batch_leaves_the_stored_snapshot_exactly_as_it_was()
        {
            // FR-013, and the requirement the whole US3 story rests on: an
            // outage must not be able to destroy the data that makes the outage
            // survivable. A half-fetched batch that overwrote the good snapshot
            // would turn a bad minute into a permanent loss.
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(1), Title("tmdb:movie:27205"));
            var before = harness.Store.Held("BR");

            harness.Provider.Fails = new HttpRequestException("the provider is down");

            // The exception is not swallowed — the caller is a background task
            // whose job is to log it (T030).
            await Assert.ThrowsAsync<HttpRequestException>(() => harness.Refresh());

            Assert.Empty(harness.Store.Saves);
            Assert.Same(before, harness.Store.Held("BR"));
        }

        [Fact]
        public async Task A_batch_that_retrieves_nothing_does_not_replace_a_good_snapshot()
        {
            // A provider having a bad day returns success with nothing in it.
            // Storing that would empty a region's deck and call it fresh data —
            // the same loss as FR-013's, arrived at without an exception.
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(1), Title("tmdb:movie:27205"));
            harness.Provider.Titles = [];

            await harness.Refresh();

            Assert.Empty(harness.Store.Saves);
            Assert.Single(harness.Store.Held("BR")!.Titles);
        }

        [Fact]
        public async Task A_batch_that_succeeds_replaces_the_snapshot_once_with_its_own_instant()
        {
            var harness = new Harness().Holding(Now - TimeSpan.FromHours(25), Title("tmdb:movie:1"));
            harness.Provider.Titles = [Title("tmdb:movie:2"), Title("tmdb:tv:3")];

            await harness.Refresh();

            var saved = Assert.Single(harness.Store.Saves);

            Assert.Equal("BR", saved.Region);
            Assert.Equal(["tmdb:movie:2", "tmdb:tv:3"], saved.Titles.Select(title => title.Id));

            // The instant is the batch's, read from the clock seam: it is what
            // the staleness bound is measured against next time, so a snapshot
            // stamped with anything else would age at the wrong rate.
            Assert.Equal(Now, saved.FetchedAt);
        }

        [Fact]
        public async Task A_regions_snapshot_is_never_written_under_another_region()
        {
            // The swap is per region. A batch for one region landing on
            // another's row would give every visitor in the second region the
            // first region's badges — confidently wrong, and invisible until
            // someone travelled.
            var harness = new Harness();
            harness.Provider.Titles = [Title("tmdb:movie:2")];

            await harness.Refresh("US");

            Assert.Null(harness.Store.Held("BR"));
            Assert.Equal("US", harness.Store.Held("US")!.Region);
        }
    }

    public class TheRequestPathNeverRunsABatch
    {
        [Fact]
        public async Task Every_state_that_needs_a_retrieval_hands_it_to_the_refresher()
        {
            // Both the states that want a batch — nothing stored, and stale —
            // go through the same port, and neither one fetches. That is what
            // makes single-flight possible at all: the refresher is the only
            // thing that runs a batch, so it is the only thing that has to know
            // whether one is already running (research D16).
            var cold = new Harness();
            await cold.Get();

            var stale = new Harness().Holding(Now - TimeSpan.FromHours(25));
            await stale.Get();

            Assert.Equal(["BR"], cold.Refresher.Started);
            Assert.Equal(["BR"], stale.Refresher.Started);
            Assert.Equal(0, cold.Provider.Fetches + stale.Provider.Fetches);
        }
    }
}

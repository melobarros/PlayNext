using PlayNext.Application.Interfaces;
using PlayNext.Domain;

namespace PlayNext.Application.UseCases;

/// <summary>
/// Turns "ninety days" into the instant the store is asked to delete before
/// (T057, FR-018).
///
/// Thin on purpose, exactly like <see cref="CatalogRetentionUseCase"/>: the rule
/// lives in <see cref="RecommendationRetention"/> so it can be reasoned about —
/// and tested — without a clock or a database, and this class exists to give it
/// a clock and a caller. Nothing here catches: whether a failed pass is fatal is
/// the caller's question, and the background service's answer is "log it and
/// try again tomorrow".
/// </summary>
public sealed class PurgeRecommendationEventsUseCase(
    IRecommendationRetentionStore store,
    TimeProvider time)
{
    /// <summary>Runs one purge and returns the number of impressions deleted.</summary>
    public Task<int> PurgeAsync(CancellationToken cancellationToken) =>
        store.PurgeAsync(RecommendationRetention.Cutoff(time.GetUtcNow()), cancellationToken);
}

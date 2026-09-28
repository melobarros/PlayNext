namespace PlayNext.Application.Interfaces;

/// <summary>
/// Starts a region's retrieval, off the request that noticed it was needed
/// (research D10, FR-014).
///
/// A port rather than a direct call for one reason: the visitor's request must
/// not wait for it. Composing a region's pool is hundreds of upstream calls —
/// seconds at best — and the contract answers a request that finds no snapshot
/// with "not ready" immediately, having *started* the work rather than sharing
/// in it. Whatever runs that work needs a service scope of its own, which is an
/// infrastructure concern the use case should not be holding.
/// </summary>
public interface ICatalogRefresher
{
    /// <summary>
    /// Starts a retrieval for a region, or reports that one is already under
    /// way. Never blocks, never throws, and never starts a second batch for a
    /// region whose first has not finished — the provider's rate limit is soft
    /// and enforced, so a stampede of visitors arriving at a cold catalog must
    /// still produce exactly one batch (research D16).
    /// </summary>
    /// <returns><c>true</c> when this call started the batch.</returns>
    bool TryStart(string region);

    /// <summary>
    /// Whether a retrieval for the region is in flight. For logging and for the
    /// tests that assert single-flight; nothing decides anything on it.
    /// </summary>
    bool IsRunning(string region);
}

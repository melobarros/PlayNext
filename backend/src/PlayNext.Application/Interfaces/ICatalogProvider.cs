using PlayNext.Domain;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The catalog provider, as the use case needs it: "give me every title for
/// this region, complete enough to render" (research D4, FR-020).
///
/// One method, because a title's availability and its trailer are only knowable
/// per title upstream — the implementation folds them into a single enriched
/// call per title, and the shape of that work is not the use case's business.
/// What the use case does own is <i>when</i> this runs: never on a request's
/// critical path (research D10).
/// </summary>
public interface ICatalogProvider
{
    /// <summary>
    /// Composes the region's pool: every title, deduplicated, at full card and
    /// detail depth.
    ///
    /// Throws when the batch cannot be completed. A partial batch is not a
    /// result — the caller treats any failure as "nothing was retrieved", which
    /// is what keeps a half-fetched catalog from replacing a good one (FR-013).
    /// </summary>
    Task<IReadOnlyList<CatalogTitle>> FetchAsync(string region, CancellationToken cancellationToken);
}

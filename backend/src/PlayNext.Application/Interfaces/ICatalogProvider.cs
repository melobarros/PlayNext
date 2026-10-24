using PlayNext.Application.Contracts;
using PlayNext.Domain;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The catalog provider, as the use cases need it: the legacy whole-region
/// fetch (005), and the planned discovery + single-enrichment seams the
/// normalized refresh is built from (feature 008, research D4).
/// </summary>
public interface ICatalogProvider
{
    /// <summary>
    /// Composes the region's pool in one pass: every title, deduplicated, at
    /// full card and detail depth. Used by the snapshot source.
    ///
    /// Throws when the batch cannot be completed. A partial batch is not a
    /// result — the caller treats any failure as "nothing was retrieved".
    /// </summary>
    Task<IReadOnlyList<CatalogTitle>> FetchAsync(string region, CancellationToken cancellationToken);

    /// <summary>
    /// Runs one discovery query for one slice, paging no further than
    /// <see cref="CatalogSlice.MaxPages"/> and stopping at the query's target.
    ///
    /// Discovery is filtered to the slice's provider ids and the region, which
    /// is what makes the result that service's catalog rather than a sample of
    /// the region's.
    /// </summary>
    Task<IReadOnlyList<CatalogCandidate>> DiscoverAsync(
        string region,
        CatalogSlice slice,
        CatalogDiscoveryQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// One enriched call per title: availability, offers, trailer, and the
    /// region's watch page. The caller deduplicates first, so a title carried by
    /// six services costs one call rather than six (FR-012).
    /// </summary>
    Task<CatalogTitleObservation> EnrichAsync(
        string region,
        CatalogCandidate candidate,
        CancellationToken cancellationToken);
}

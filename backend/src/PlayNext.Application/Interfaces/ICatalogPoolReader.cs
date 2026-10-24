using PlayNext.Application.Contracts;
using PlayNext.Domain;

namespace PlayNext.Application.Interfaces;

/// <summary>
/// The normalized read path: a version pinned once, then the pool query it
/// describes (data-model "Query semantics").
/// </summary>
public interface ICatalogPoolReader
{
    /// <summary>
    /// Reads one query from one version. The version is supplied rather than
    /// resolved here, which is what pins genres, availability, and titles to the
    /// same catalog state.
    /// </summary>
    Task<CatalogSnapshot> ReadAsync(
        CatalogVersionRef version,
        CatalogPoolQuery query,
        CancellationToken cancellationToken);
}

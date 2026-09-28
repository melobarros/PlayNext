namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The last catalog snapshot that was successfully retrieved for one region
/// (data-model.md, "CatalogSnapshot").
///
/// This is a cache of the provider's data, never a second source of truth, and
/// it is the only entity this feature persists. It exists because the API is
/// hosted scale-to-zero: an in-memory-only cache would make the first visitor
/// after every scale-up pay the refresh, and FR-012/013's "the last successful
/// catalog keeps serving" would not survive the very restart that usually
/// accompanies an outage (research D10).
///
/// A row is replaced whole, never patched. A refresh that fails part-way writes
/// nothing at all, so what is stored here is always a complete, self-consistent
/// snapshot (FR-013).
/// </summary>
public class CatalogSnapshot
{
    /// <summary>
    /// ISO 3166-1 alpha-2, uppercase. The primary key: one row per region, which
    /// is also the whole of the region relationship — nothing references this
    /// table (data-model.md).
    /// </summary>
    public string Region { get; set; } = string.Empty;

    /// <summary>
    /// When the batch that produced this snapshot succeeded. This is what the
    /// staleness bound is measured against, and what the response reports as
    /// <c>fetchedAt</c> (informational to the client).
    /// </summary>
    public DateTimeOffset FetchedAt { get; set; }

    /// <summary>
    /// The whole snapshot exactly as it is served: <c>{ region, fetchedAt,
    /// titles[] }</c>. Stored as jsonb so a future query can reach into it, and
    /// so the stored bytes are the response bytes rather than a reparsed
    /// approximation.
    /// </summary>
    public string PayloadJson { get; set; } = string.Empty;
}

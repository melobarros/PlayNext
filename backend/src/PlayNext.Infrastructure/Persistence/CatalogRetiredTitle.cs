namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The readable copy of a title that left the catalog while a visitor still
/// references it (data-model §10). It is returned only by an <c>ids</c> lookup,
/// never by a pool, and it stores <b>no availability</b>: provider carriage data
/// past the retention limit is exactly what must not be kept.
/// </summary>
public sealed class CatalogRetiredTitle
{
    public string TitleId { get; set; } = string.Empty;

    /// <summary>The wire title, with <c>availability: []</c>.</summary>
    public string PayloadJson { get; set; } = "{}";

    public DateTimeOffset LastObservedAt { get; set; }

    public DateTimeOffset RetiredAt { get; set; }

    public CatalogTitleIdentity? Identity { get; set; }
}

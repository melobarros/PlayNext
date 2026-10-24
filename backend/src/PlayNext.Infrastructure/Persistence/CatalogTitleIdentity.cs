namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The durable title-id anchor (data-model §9). It holds no provider metadata,
/// so it is not governed by the retention limit, and it is what the new foreign
/// keys from user rows point at.
/// </summary>
public sealed class CatalogTitleIdentity
{
    public string TitleId { get; set; } = string.Empty;

    public DateTimeOffset FirstSeenAt { get; set; }
}

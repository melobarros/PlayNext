namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The catalog's operational knobs (feature 008, contracts/catalog-refresh.md).
///
/// <see cref="Source"/> is the rollback switch: it selects which storage serves
/// <c>GET /api/catalog</c>. It is read per request rather than captured at
/// startup, so flipping it is a configuration change plus a restart — no
/// deployment (FR-007, SC-005).
/// </summary>
public sealed class CatalogOptions
{
    public const string SectionName = "Catalog";

    /// <summary>
    /// <c>Snapshot</c> (the 005 path) or <c>Normalized</c> (the versioned rows).
    /// Unrecognized values fall back to the snapshot path: a typo must not make
    /// the catalog unreadable.
    /// </summary>
    public string Source { get; set; } = CatalogSources.Snapshot;

    /// <summary>
    /// Enables the server-to-server admin routes. Empty means the routes are not
    /// mapped at all — a disabled feature must not advertise itself.
    /// </summary>
    public string AdminToken { get; set; } = string.Empty;

    /// <summary>The cap on a targeted pool response.</summary>
    public int MaxPoolTitles { get; set; } = 1000;

    /// <summary>The cap on an <c>ids</c> batch.</summary>
    public int MaxIdsPerRequest { get; set; } = 1000;

    /// <summary>The soft budget for one refresh, in minutes.</summary>
    public int RefreshTimeoutMinutes { get; set; } = 55;

    public CatalogMigrationOptions Migration { get; set; } = new();
}

/// <summary>Gates the opt-in one-shot snapshot migration.</summary>
public sealed class CatalogMigrationOptions
{
    public bool Enabled { get; set; }
}

/// <summary>The two values <see cref="CatalogOptions.Source"/> may name.</summary>
public static class CatalogSources
{
    public const string Snapshot = "Snapshot";
    public const string Normalized = "Normalized";

    /// <summary>
    /// Whether a configured value selects the normalized path. Comparison is
    /// case-insensitive because app settings are typed by hand; anything else
    /// is the snapshot path.
    /// </summary>
    public static bool IsNormalized(string? source) =>
        string.Equals(source?.Trim(), Normalized, StringComparison.OrdinalIgnoreCase);
}

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// One refresh or migration execution (data-model §8). Never contains a title,
/// a payload, or a credential — counts and sanitized failures only.
/// </summary>
public sealed class CatalogRefreshRun
{
    public Guid Id { get; set; }

    /// <summary><c>Refresh</c> or <c>Migration</c>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary><c>Configured</c>, <c>Normalized</c>, <c>Snapshot</c>, or null for a migration.</summary>
    public string? Mode { get; set; }

    public string Region { get; set; } = string.Empty;

    /// <summary><c>Running</c>, <c>Succeeded</c>, <c>PartiallyFailed</c>, <c>Failed</c>, or <c>Abandoned</c>.</summary>
    public string Status { get; set; } = CatalogRunStatuses.Running;

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public Guid? VersionId { get; set; }

    /// <summary>Per-slice counts, serialized. Never title data.</summary>
    public string CountsJson { get; set; } = "{}";

    /// <summary>Per-slice sanitized failures, serialized.</summary>
    public string FailuresJson { get; set; } = "{}";

    public string? Error { get; set; }
}

public static class CatalogRunStatuses
{
    public const string Running = "Running";
    public const string Succeeded = "Succeeded";
    public const string PartiallyFailed = "PartiallyFailed";
    public const string Failed = "Failed";
    public const string Abandoned = "Abandoned";
}

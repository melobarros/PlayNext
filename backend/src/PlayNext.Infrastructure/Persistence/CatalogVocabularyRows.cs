namespace PlayNext.Infrastructure.Persistence;

/// <summary>The genre vocabulary (data-model §1).</summary>
public sealed class CatalogGenre
{
    public string Id { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Unique when present; null for a genre the provider does not have.</summary>
    public int? TmdbId { get; set; }

    public bool IsSelectable { get; set; }

    public int Position { get; set; }
}

/// <summary>A streaming service, quiz or not (data-model §2).</summary>
public sealed class CatalogService
{
    public string Id { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>The 005 deep-link template; null when there is no template.</summary>
    public string? SearchTemplate { get; set; }

    public bool IsQuizService { get; set; }

    public int Position { get; set; }
}

/// <summary>The provider-id to canonical-service mapping, aliases included (data-model §3).</summary>
public sealed class CatalogServiceProvider
{
    public int TmdbProviderId { get; set; }

    public string ServiceId { get; set; } = string.Empty;

    public CatalogService? Service { get; set; }
}

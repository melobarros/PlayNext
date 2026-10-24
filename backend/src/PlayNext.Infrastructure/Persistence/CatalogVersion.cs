namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// One complete, invisible-until-promoted view of a region's catalog
/// (data-model §4).
/// </summary>
public sealed class CatalogVersion
{
    public Guid Id { get; set; }

    public string Region { get; set; } = string.Empty;

    /// <summary><c>Building</c>, <c>Active</c>, or <c>Superseded</c>.</summary>
    public string State { get; set; } = CatalogVersionStates.Building;

    /// <summary><c>Refresh</c> or <c>Migration</c>.</summary>
    public string Source { get; set; } = CatalogVersionSources.Refresh;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>The response's <c>fetchedAt</c>.</summary>
    public DateTimeOffset FetchedAt { get; set; }

    /// <summary>The newest row observation; the retention gate for reads.</summary>
    public DateTimeOffset? LatestObservedAt { get; set; }

    public List<CatalogTitleRecord> Titles { get; set; } = [];
}

public static class CatalogVersionStates
{
    public const string Building = "Building";
    public const string Active = "Active";
    public const string Superseded = "Superseded";
}

public static class CatalogVersionSources
{
    public const string Refresh = "Refresh";
    public const string Migration = "Migration";
}

/// <summary>
/// One title in one version (data-model §5).
///
/// Named <c>…Record</c> to keep the entity distinct from
/// <see cref="PlayNext.Domain.CatalogTitle"/>, the wire shape it maps to.
/// </summary>
public sealed class CatalogTitleRecord
{
    public Guid VersionId { get; set; }

    /// <summary><c>tmdb:{movie|tv}:{id}</c>, unchanged from 005.</summary>
    public string TitleId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int ReleaseYear { get; set; }

    /// <summary><c>movie</c>, <c>tv</c>, or <c>anime</c>.</summary>
    public string MediaType { get; set; } = string.Empty;

    public string Synopsis { get; set; } = string.Empty;

    public double Rating { get; set; }

    public int VoteCount { get; set; }

    public int? RuntimeMinutes { get; set; }

    public string? TrailerUrl { get; set; }

    public string? PosterUrl { get; set; }

    /// <summary>Discovery popularity; 0 for migrated titles.</summary>
    public double Popularity { get; set; }

    public bool InGeneralPool { get; set; }

    public int PoolPosition { get; set; }

    /// <summary>When this title was last actually observed; carried rows keep their original value.</summary>
    public DateTimeOffset LastObservedAt { get; set; }

    public CatalogVersion? Version { get; set; }

    public List<CatalogTitleGenre> Genres { get; set; } = [];

    public List<CatalogAvailability> Availability { get; set; } = [];
}

/// <summary>One genre of one title, in wire order (data-model §6).</summary>
public sealed class CatalogTitleGenre
{
    public Guid VersionId { get; set; }

    public string TitleId { get; set; } = string.Empty;

    public string GenreId { get; set; } = string.Empty;

    public int Position { get; set; }

    public CatalogTitleRecord? Title { get; set; }

    public CatalogGenre? Genre { get; set; }
}

/// <summary>One service carrying one title in the version's region (data-model §7).</summary>
public sealed class CatalogAvailability
{
    public Guid VersionId { get; set; }

    public string TitleId { get; set; } = string.Empty;

    public string ServiceId { get; set; } = string.Empty;

    public string Region { get; set; } = string.Empty;

    /// <summary><c>flatrate</c>, <c>free</c>, <c>ads</c>, or <c>unknown</c> for migrated rows.</summary>
    public string Monetization { get; set; } = string.Empty;

    public string DeepLinkUrl { get; set; } = string.Empty;

    public int Position { get; set; }

    public DateTimeOffset LastObservedAt { get; set; }

    public CatalogTitleRecord? Title { get; set; }

    public CatalogService? Service { get; set; }
}

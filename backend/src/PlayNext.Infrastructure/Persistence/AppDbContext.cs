using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// The account store.
///
/// Derives from <see cref="IdentityUserContext{TUser, TKey}"/> rather than
/// <c>IdentityDbContext</c>: this project has no roles and no role claims, and
/// deriving from the role-bearing base would create five tables nothing ever
/// writes to. The API registers <c>AddIdentityCore</c> to match, which also
/// avoids registering the cookie sign-in schemes that a JWT API does not want.
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityUserContext<ApplicationUser, Guid>(options)
{
    /// <summary>The visitor's ratings, keyed by <c>(UserId, TitleId)</c>.</summary>
    public DbSet<UserInteraction> Interactions => Set<UserInteraction>();

    /// <summary>The visitor's watching log.</summary>
    public DbSet<UserWatchHistoryEntry> WatchHistory => Set<UserWatchHistoryEntry>();

    /// <summary>The visitor's completed quiz — at most one row each.</summary>
    public DbSet<UserPreference> Preferences => Set<UserPreference>();

    /// <summary>Issued refresh tokens, as hashes.</summary>
    public DbSet<UserSession> Sessions => Set<UserSession>();

    /// <summary>
    /// The last catalog snapshot per region (005). A cache of the provider, not
    /// account data — nothing references it and it references nothing. Still the
    /// rollback document and the migration source (008).
    /// </summary>
    public DbSet<CatalogSnapshot> CatalogSnapshots => Set<CatalogSnapshot>();

    // -----------------------------------------------------------------------
    // The normalized catalog (008)
    // -----------------------------------------------------------------------

    public DbSet<CatalogVersion> CatalogVersions => Set<CatalogVersion>();

    public DbSet<CatalogTitleRecord> CatalogTitles => Set<CatalogTitleRecord>();

    public DbSet<CatalogTitleGenre> CatalogTitleGenres => Set<CatalogTitleGenre>();

    public DbSet<CatalogAvailability> CatalogAvailability => Set<CatalogAvailability>();

    public DbSet<CatalogGenre> CatalogGenres => Set<CatalogGenre>();

    public DbSet<CatalogService> CatalogServices => Set<CatalogService>();

    public DbSet<CatalogServiceProvider> CatalogServiceProviders => Set<CatalogServiceProvider>();

    public DbSet<CatalogRefreshRun> CatalogRefreshRuns => Set<CatalogRefreshRun>();

    public DbSet<CatalogTitleIdentity> CatalogTitleIdentities => Set<CatalogTitleIdentity>();

    public DbSet<CatalogRetiredTitle> CatalogRetiredTitles => Set<CatalogRetiredTitle>();

    // -----------------------------------------------------------------------
    // Recommendation telemetry (009)
    // -----------------------------------------------------------------------

    /// <summary>Every recommendation card displayed. Append-only.</summary>
    public DbSet<RecommendationImpression> RecommendationImpressions => Set<RecommendationImpression>();

    /// <summary>Every visitor response to a displayed card. Append-only.</summary>
    public DbSet<RecommendationAction> RecommendationActions => Set<RecommendationAction>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ApplicationUser>(user =>
        {
            user.Property(u => u.Region).HasMaxLength(8).IsRequired();
        });

        builder.Entity<UserInteraction>(interaction =>
        {
            // The composite key is both the "one rating per title" guarantee and
            // the (UserId, TitleId) index the constitution names — so no second
            // index is declared here.
            interaction.HasKey(i => new { i.UserId, i.TitleId });

            interaction.Property(i => i.TitleId).HasMaxLength(64);

            // Stored as the wire name, not the enum's ordinal. The column then
            // reads as the vocabulary the spec, the API and the client all use
            // ("wantToWatch"), and reordering the C# enum cannot silently
            // reinterpret every stored rating.
            interaction
                .Property(i => i.State)
                .HasConversion(
                    state => InteractionStates.ToWire(state),
                    wire => ParseState(wire))
                .HasMaxLength(16);

            interaction
                .HasOne(i => i.User)
                .WithMany()
                .HasForeignKey(i => i.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // The durable identity anchor (data-model §9). RESTRICT, not
            // cascade: a title id with user rows behind it must never disappear
            // because a catalog cleanup ran.
            interaction
                .HasOne<CatalogTitleIdentity>()
                .WithMany()
                .HasForeignKey(i => i.TitleId)
                .OnDelete(DeleteBehavior.Restrict);

            interaction.HasIndex(i => i.TitleId);
        });

        builder.Entity<UserWatchHistoryEntry>(entry =>
        {
            entry.Property(e => e.TitleId).HasMaxLength(64);

            // Retried migrations re-upload the same pair; the unique index is
            // what turns that into a no-op instead of a duplicate (research D4).
            entry.HasIndex(e => new { e.UserId, e.TitleId, e.ChosenAt }).IsUnique();

            entry
                .HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entry
                .HasOne<CatalogTitleIdentity>()
                .WithMany()
                .HasForeignKey(e => e.TitleId)
                .OnDelete(DeleteBehavior.Restrict);

            entry.HasIndex(e => e.TitleId);
        });

        builder.Entity<UserPreference>(preference =>
        {
            preference.HasKey(p => p.UserId);

            // jsonb, matching the document shape the 001 contract freezes. The
            // converter is shared by all three columns so the shape is declared
            // once and cannot drift between them.
            preference
                .Property(p => p.MediaType)
                .HasConversion(DimensionChoiceConverter)
                .HasColumnType("jsonb");

            preference
                .Property(p => p.Genre)
                .HasConversion(DimensionChoiceConverter)
                .HasColumnType("jsonb");

            preference
                .Property(p => p.Provider)
                .HasConversion(DimensionChoiceConverter)
                .HasColumnType("jsonb");

            preference
                .HasOne(p => p.User)
                .WithMany()
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<UserSession>(session =>
        {
            session.Property(s => s.TokenHash).HasMaxLength(64).IsRequired();

            // Every authenticated refresh looks a session up by hash, so this
            // index is on the hot path rather than an optimization.
            session.HasIndex(s => s.TokenHash).IsUnique();

            session
                .HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<CatalogSnapshot>(snapshot =>
        {
            // The region *is* the identity — there is no surrogate key, because
            // a second row for a region would be a second answer to the same
            // question rather than a second record.
            snapshot.HasKey(s => s.Region);

            snapshot.Property(s => s.Region).HasMaxLength(2);

            // jsonb, like the preference dimensions: the stored bytes are the
            // snapshot as served, and Postgres validates the JSON on write — a
            // truncated payload can never be stored and then served as if whole.
            snapshot.Property(s => s.PayloadJson).HasColumnType("jsonb");
        });

        ConfigureNormalizedCatalog(builder);
        ConfigureRecommendationTelemetry(builder);
    }

    /// <summary>
    /// The telemetry tables' keys, indexes, and one foreign key (data-model
    /// §Persistent model).
    ///
    /// The client event ids are unique indexes rather than primary keys because
    /// the server still needs a monotonic key to link actions and to purge in
    /// batches. The account and title columns deliberately carry no foreign
    /// key: this is an observation log, and it must outlive both the account it
    /// describes and the catalog row it names (research D4).
    /// </summary>
    private static void ConfigureRecommendationTelemetry(ModelBuilder builder)
    {
        builder.Entity<RecommendationImpression>(impression =>
        {
            impression.HasKey(i => i.Id);

            impression.Property(i => i.ClientEventId).IsRequired();
            impression.HasIndex(i => i.ClientEventId).IsUnique();

            impression.Property(i => i.SessionId).HasMaxLength(64).IsRequired();
            impression.Property(i => i.TitleId).HasMaxLength(64).IsRequired();
            impression.Property(i => i.Surface).HasMaxLength(16).IsRequired();
            impression.Property(i => i.EngineVersion).HasMaxLength(32).IsRequired();
            impression.Property(i => i.FilterHash).HasMaxLength(32).IsRequired();
            impression.Property(i => i.ReasonCode).HasMaxLength(32).IsRequired();

            impression.HasIndex(i => new { i.SessionId, i.ReceivedAt });
            impression.HasIndex(i => i.ReceivedAt);
            impression.HasIndex(i => new { i.TitleId, i.ReceivedAt });

            // Partial: most events are anonymous, so an unconditional index
            // would be mostly nulls and would not serve the account queries.
            impression
                .HasIndex(i => new { i.UserId, i.ReceivedAt })
                .HasFilter("\"UserId\" IS NOT NULL");
        });

        builder.Entity<RecommendationAction>(action =>
        {
            action.HasKey(a => a.Id);

            action.Property(a => a.ClientEventId).IsRequired();
            action.HasIndex(a => a.ClientEventId).IsUnique();

            action.Property(a => a.Kind).HasMaxLength(16).IsRequired();

            action
                .HasOne(a => a.Impression)
                .WithMany(i => i.Actions)
                .HasForeignKey(a => a.ImpressionId)
                .OnDelete(DeleteBehavior.Cascade);

            action.HasIndex(a => new { a.Kind, a.ReceivedAt });
        });
    }

    /// <summary>
    /// The versioned catalog's keys, indexes, and foreign keys (data-model
    /// §1–§10).
    ///
    /// The two partial unique indexes are the state machine's foundation: at
    /// most one <c>Active</c> and at most one <c>Building</c> version per region,
    /// enforced by the database rather than by every writer remembering to check.
    /// </summary>
    private static void ConfigureNormalizedCatalog(ModelBuilder builder)
    {
        builder.Entity<CatalogGenre>(genre =>
        {
            genre.HasKey(g => g.Id);
            genre.Property(g => g.Id).HasMaxLength(64);
            genre.Property(g => g.DisplayName).HasMaxLength(128).IsRequired();
            genre.HasIndex(g => g.TmdbId).IsUnique();
        });

        builder.Entity<CatalogService>(service =>
        {
            service.HasKey(s => s.Id);
            service.Property(s => s.Id).HasMaxLength(64);
            service.Property(s => s.DisplayName).HasMaxLength(128).IsRequired();
        });

        builder.Entity<CatalogServiceProvider>(provider =>
        {
            provider.HasKey(p => p.TmdbProviderId);
            provider.Property(p => p.ServiceId).HasMaxLength(64).IsRequired();
            provider
                .HasOne(p => p.Service)
                .WithMany()
                .HasForeignKey(p => p.ServiceId)
                .OnDelete(DeleteBehavior.Restrict);
            provider.HasIndex(p => p.ServiceId);
        });

        builder.Entity<CatalogTitleIdentity>(identity =>
        {
            identity.HasKey(i => i.TitleId);
            identity.Property(i => i.TitleId).HasMaxLength(64);
        });

        builder.Entity<CatalogVersion>(version =>
        {
            version.HasKey(v => v.Id);
            version.Property(v => v.Region).HasMaxLength(2).IsRequired();
            version.Property(v => v.State).HasMaxLength(16).IsRequired();
            version.Property(v => v.Source).HasMaxLength(16).IsRequired();

            version.HasIndex(v => new { v.Region, v.State });

            // Named rather than property-identified: two indexes over the same
            // column differ only by their filter, and EF otherwise folds both
            // configurations into one index and emits whichever filter was
            // written last — leaving the other state unguarded.
            version
                .HasIndex(v => v.Region, "IX_CatalogVersions_Region_Active")
                .IsUnique()
                .HasFilter("\"State\" = 'Active'");

            version
                .HasIndex(v => v.Region, "IX_CatalogVersions_Region_Building")
                .IsUnique()
                .HasFilter("\"State\" = 'Building'");
        });

        builder.Entity<CatalogTitleRecord>(title =>
        {
            title.ToTable("CatalogTitles");
            title.HasKey(t => new { t.VersionId, t.TitleId });
            title.Property(t => t.TitleId).HasMaxLength(64);
            title.Property(t => t.Name).HasMaxLength(512).IsRequired();
            title.Property(t => t.MediaType).HasMaxLength(8).IsRequired();
            title.Property(t => t.Synopsis).IsRequired();

            title
                .HasOne(t => t.Version)
                .WithMany(v => v.Titles)
                .HasForeignKey(t => t.VersionId)
                .OnDelete(DeleteBehavior.Cascade);

            title
                .HasOne<CatalogTitleIdentity>()
                .WithMany()
                .HasForeignKey(t => t.TitleId)
                .OnDelete(DeleteBehavior.Restrict);

            title.HasIndex(t => new { t.VersionId, t.InGeneralPool, t.PoolPosition });
            title.HasIndex(t => new { t.VersionId, t.MediaType, t.TitleId });
            title.HasIndex(t => new { t.VersionId, t.Popularity, t.TitleId }).IsDescending(false, true, false);
            title.HasIndex(t => new { t.VersionId, t.LastObservedAt });
        });

        builder.Entity<CatalogTitleGenre>(genre =>
        {
            genre.HasKey(g => new { g.VersionId, g.TitleId, g.GenreId });
            genre.Property(g => g.GenreId).HasMaxLength(64);

            genre
                .HasOne(g => g.Title)
                .WithMany(t => t.Genres)
                .HasForeignKey(g => new { g.VersionId, g.TitleId })
                .OnDelete(DeleteBehavior.Cascade);

            genre
                .HasOne(g => g.Genre)
                .WithMany()
                .HasForeignKey(g => g.GenreId)
                .OnDelete(DeleteBehavior.Restrict);

            genre.HasIndex(g => new { g.VersionId, g.TitleId, g.Position }).IsUnique();
            genre.HasIndex(g => new { g.VersionId, g.GenreId, g.TitleId });
        });

        builder.Entity<CatalogAvailability>(availability =>
        {
            availability.HasKey(a => new { a.VersionId, a.TitleId, a.ServiceId, a.Region });
            availability.Property(a => a.ServiceId).HasMaxLength(64);
            availability.Property(a => a.Region).HasMaxLength(2);
            availability.Property(a => a.Monetization).HasMaxLength(16).IsRequired();
            availability.Property(a => a.DeepLinkUrl).IsRequired();

            availability
                .HasOne(a => a.Title)
                .WithMany(t => t.Availability)
                .HasForeignKey(a => new { a.VersionId, a.TitleId })
                .OnDelete(DeleteBehavior.Cascade);

            availability
                .HasOne(a => a.Service)
                .WithMany()
                .HasForeignKey(a => a.ServiceId)
                .OnDelete(DeleteBehavior.Restrict);

            availability.HasIndex(a => new { a.VersionId, a.TitleId, a.Position }).IsUnique();
            availability.HasIndex(a => new { a.VersionId, a.Region, a.ServiceId, a.TitleId });
            availability.HasIndex(a => new { a.VersionId, a.LastObservedAt });
        });

        builder.Entity<CatalogRefreshRun>(run =>
        {
            run.HasKey(r => r.Id);
            run.Property(r => r.Kind).HasMaxLength(16).IsRequired();
            run.Property(r => r.Mode).HasMaxLength(16);
            run.Property(r => r.Region).HasMaxLength(2).IsRequired();
            run.Property(r => r.Status).HasMaxLength(24).IsRequired();
            run.Property(r => r.CountsJson).HasColumnType("jsonb");
            run.Property(r => r.FailuresJson).HasColumnType("jsonb");

            run.HasIndex(r => new { r.Region, r.StartedAt }).IsDescending(false, true);
            run.HasIndex(r => r.Status);

            // A superseded version is deleted after a day; its run record must
            // outlive it, so the pointer is nulled rather than the run removed.
            run
                .HasOne<CatalogVersion>()
                .WithMany()
                .HasForeignKey(r => r.VersionId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<CatalogRetiredTitle>(retired =>
        {
            retired.HasKey(r => r.TitleId);
            retired.Property(r => r.TitleId).HasMaxLength(64);
            retired.Property(r => r.PayloadJson).HasColumnType("jsonb").IsRequired();

            retired
                .HasOne(r => r.Identity)
                .WithMany()
                .HasForeignKey(r => r.TitleId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static readonly JsonSerializerOptions DimensionChoiceJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// Serializes a <see cref="DimensionChoice"/> to the contract's
    /// <c>{values, any}</c> shape.
    ///
    /// Deserialization deliberately throws on malformed JSON rather than
    /// yielding a default: the "fail-safe on read" rule belongs to the device
    /// documents (which may have been written by an older build), whereas a
    /// malformed row here is corrupt data, and quietly turning it into "no
    /// preference" would silently change which titles the deck suggests.
    /// </summary>
    private static readonly ValueConverter<DimensionChoice, string> DimensionChoiceConverter = new(
        choice => SerializeDimensionChoice(choice),
        json => DeserializeDimensionChoice(json));

    private static string SerializeDimensionChoice(DimensionChoice choice)
        => JsonSerializer.Serialize(choice, DimensionChoiceJson);

    private static DimensionChoice DeserializeDimensionChoice(string json)
        => JsonSerializer.Deserialize<DimensionChoice>(json, DimensionChoiceJson)
            ?? throw new InvalidOperationException("Stored dimension choice is null.");

    private static InteractionState ParseState(string wire)
    {
        return InteractionStates.TryParse(wire, out var state)
            ? state
            : throw new InvalidOperationException($"Stored interaction state '{wire}' is not in the vocabulary.");
    }
}

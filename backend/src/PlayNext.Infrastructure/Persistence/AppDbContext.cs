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

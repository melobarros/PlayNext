using Microsoft.EntityFrameworkCore;
using PlayNext.Domain;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// Writes the domain's vocabulary into the dimension tables (data-model §1–§3).
///
/// The seed is the same <see cref="CatalogVocabulary"/> the domain maps with, so
/// a row and its meaning cannot drift: the seeder is an upsert of data that is
/// already the rule, not a second copy of it. Running it at startup, on every
/// instance, is safe — and deliberate, because the alternative is a deployment
/// step that has to remember to run before the first refresh.
/// </summary>
public sealed class CatalogVocabularySeeder(AppDbContext db)
{
    /// <summary>
    /// The transaction-scoped advisory lock that serializes seeders.
    /// The value is <c>0x506C61794E657874</c> — "PlayNext" in ASCII — chosen so
    /// it cannot collide with a lock key another feature invents by accident.
    /// </summary>
    private const long SeedLockKey = 0x506C61794E657874;

    public async Task SeedAsync(CancellationToken cancellationToken)
    {
        // Every instance seeds at startup, and two instances starting together
        // against a fresh database would both read an empty table and both
        // insert the same vocabulary; the second would fail on the primary key.
        // The advisory lock is taken before the reads, in the same transaction,
        // so the second instance waits and then sees the first one's committed
        // rows and turns its inserts into updates. A crashed start releases the
        // lock with the transaction.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({SeedLockKey})",
            cancellationToken);

        await SeedGenresAsync(cancellationToken);
        await SeedServicesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    private async Task SeedGenresAsync(CancellationToken cancellationToken)
    {
        var existing = await db.CatalogGenres
            .ToDictionaryAsync(genre => genre.Id, StringComparer.Ordinal, cancellationToken);

        foreach (var seed in CatalogVocabulary.Genres)
        {
            if (!existing.TryGetValue(seed.Id, out var row))
            {
                db.CatalogGenres.Add(new CatalogGenre
                {
                    Id = seed.Id,
                    DisplayName = seed.DisplayName,
                    TmdbId = seed.TmdbId,
                    IsSelectable = seed.IsSelectable,
                    Position = seed.Position,
                });

                continue;
            }

            // A genre the provider renames is a display change, not a new
            // identity: the id is what devices and stored rows hold.
            row.DisplayName = seed.DisplayName;
            row.TmdbId = seed.TmdbId;
            row.IsSelectable = seed.IsSelectable;
            row.Position = seed.Position;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task SeedServicesAsync(CancellationToken cancellationToken)
    {
        var services = await db.CatalogServices
            .ToDictionaryAsync(service => service.Id, StringComparer.Ordinal, cancellationToken);

        var providers = await db.CatalogServiceProviders
            .ToDictionaryAsync(provider => provider.TmdbProviderId, cancellationToken);

        var positions = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var provider in CatalogVocabulary.Providers)
        {
            if (!positions.ContainsKey(provider.ProviderId))
            {
                positions[provider.ProviderId] = positions.Count;
            }

            if (services.TryGetValue(provider.ProviderId, out var service))
            {
                service.DisplayName = provider.DisplayName;
                service.SearchTemplate = provider.SearchTemplate;
                service.IsQuizService = provider.VocabId is not null;
                service.Position = positions[provider.ProviderId];
            }
            else
            {
                services[provider.ProviderId] = new CatalogService
                {
                    Id = provider.ProviderId,
                    DisplayName = provider.DisplayName,
                    SearchTemplate = provider.SearchTemplate,
                    IsQuizService = provider.VocabId is not null,
                    Position = positions[provider.ProviderId],
                };

                db.CatalogServices.Add(services[provider.ProviderId]);
            }

            if (!providers.ContainsKey(provider.TmdbId))
            {
                // An alias is a second provider id for the same service, not a
                // second service (research D7).
                db.CatalogServiceProviders.Add(new CatalogServiceProvider
                {
                    TmdbProviderId = provider.TmdbId,
                    ServiceId = provider.ProviderId,
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}

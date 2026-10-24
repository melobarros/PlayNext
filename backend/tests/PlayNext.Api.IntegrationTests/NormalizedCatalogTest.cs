using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PlayNext.Application.Contracts;
using PlayNext.Application.Interfaces;
using PlayNext.Application.UseCases;
using PlayNext.Infrastructure.Catalog;
using PlayNext.Infrastructure.Persistence;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// What the normalized suites (008) need beyond <see cref="CatalogTest"/>:
/// the source switch, the migration and refresh use cases driven directly, and
/// the version tables read as rows.
///
/// The use cases are resolved and awaited in-process rather than driven through
/// the admin endpoint. A test about <i>what a refresh stores</i> wants the
/// finished run in hand, not a 202 and a poll — the admin surface has its own
/// suite, and a background run would make every assertion here a race. It is
/// still the real composition: the same singleton provider, the same
/// <c>AppDbContext</c>, the same options the host resolved.
/// </summary>
public abstract class NormalizedCatalogTest(CatalogApiFactory api) : CatalogTest(api)
{
    /// <summary>Switches reads to the versioned tables (the cutover switch, FR-007).</summary>
    protected void UseNormalized() => _api.SetSetting("Catalog:Source", "Normalized");

    /// <summary>Switches reads back to the 005 snapshot — the rollback path.</summary>
    protected void UseSnapshot() => _api.SetSetting("Catalog:Source", "Snapshot");

    /// <summary>The provider options the running host resolved.</summary>
    protected TmdbOptions ProviderOptions =>
        _api.Services.GetRequiredService<IOptions<TmdbOptions>>().Value;

    /// <summary>The catalog options the running host resolved — the caps the endpoints enforce.</summary>
    protected CatalogOptions CatalogOptions =>
        _api.Services.GetRequiredService<IOptions<CatalogOptions>>().Value;

    protected async Task<CatalogRunSummary?> MigrateAsync(string region = "BR")
    {
        using var scope = _api.Services.CreateScope();

        return await scope.ServiceProvider
            .GetRequiredService<MigrateCatalogUseCase>()
            .RunAsync(region, CancellationToken.None);
    }

    protected async Task<CatalogRunSummary?> RefreshAsync(
        string region = "BR",
        CatalogRunMode mode = CatalogRunMode.Normalized)
    {
        using var scope = _api.Services.CreateScope();

        return await scope.ServiceProvider
            .GetRequiredService<RefreshCatalogUseCase>()
            .RunAsync(region, mode, CancellationToken.None);
    }

    protected async Task<CatalogRunSummary?> LatestRunAsync(string region = "BR")
    {
        using var scope = _api.Services.CreateScope();

        return await scope.ServiceProvider
            .GetRequiredService<ICatalogRefreshRunStore>()
            .LatestAsync(region, CancellationToken.None);
    }

    protected async Task<CatalogRetentionOutcome> PurgeAsync(
        string region = "BR",
        DateTimeOffset? now = null)
    {
        using var scope = _api.Services.CreateScope();

        return await scope.ServiceProvider
            .GetRequiredService<ICatalogRetentionStore>()
            .PurgeAsync(region, now ?? DateTimeOffset.UtcNow, CancellationToken.None);
    }

    /// <summary>Runs one read against the database through a scope of its own.</summary>
    protected async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> read)
    {
        using var scope = _api.Services.CreateScope();

        return await read(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    /// <summary>The region's active version row, or <c>null</c> when none is promoted.</summary>
    protected Task<CatalogVersion?> ActiveVersionAsync(string region = "BR") =>
        WithDbAsync(db => db.CatalogVersions
            .AsNoTracking()
            .SingleOrDefaultAsync(row =>
                row.Region == region && row.State == CatalogVersionStates.Active));

    protected Task<List<CatalogVersion>> VersionsAsync(string region = "BR") =>
        WithDbAsync(db => db.CatalogVersions
            .AsNoTracking()
            .Where(row => row.Region == region)
            .ToListAsync());

    protected Task<int> TitleCountAsync(Guid versionId) =>
        WithDbAsync(db => db.CatalogTitles.CountAsync(title => title.VersionId == versionId));

    /// <summary>
    /// The raw response for <c>GET /api/catalog</c>, so a parity test can compare
    /// two payloads byte for byte rather than only field by field.
    /// </summary>
    protected async Task<(HttpStatusCode Status, string Raw, JsonObject Body)> CatalogResponseAsync(
        string region,
        string? query = null)
    {
        var client = _api.CreateClient();
        var url = $"/api/catalog?region={region}"
            + (string.IsNullOrEmpty(query) ? string.Empty : $"&{query}");

        var response = await client.GetAsync(url);
        var raw = await response.Content.ReadAsStringAsync();

        return (response.StatusCode, raw, JsonNode.Parse(raw)!.AsObject());
    }

    /// <summary>A 200 catalog read; a different status is a failure of the test's setup.</summary>
    protected async Task<JsonObject> CatalogAsync(string region = "BR", string? query = null)
    {
        var (status, _, body) = await CatalogResponseAsync(region, query);

        Assert.True(status == HttpStatusCode.OK, $"expected 200, got {(int)status}: {body}");

        return body;
    }

    /// <summary>Registers a visitor carrying the given guest document, and returns a signed-in client.</summary>
    protected async Task<HttpClient> SignUpAsync(JsonObject? guest = null)
    {
        var response = await _api.CreateClient().PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = $"visitor-{Guid.NewGuid():N}@example.com",
            ["password"] = "Correct-Horse-9!",
            ["guest"] = guest ?? new JsonObject(),
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var token = JsonNode.Parse(await response.Content.ReadAsStringAsync())!
            ["accessToken"]!.GetValue<string>();

        var client = _api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return client;
    }

    /// <summary>
    /// One title in a stored snapshot's shape — the exact property names
    /// <c>CatalogSnapshotJson</c> reads.
    /// </summary>
    protected static JsonObject SnapshotTitle(
        string id,
        string title,
        int year,
        string mediaType,
        string[] genres,
        double rating = 8.0,
        int votes = 1_000,
        int? runtimeMinutes = 100,
        string? trailerUrl = null,
        string? posterUrl = null,
        params (string ProviderId, string Link)[] availability) =>
        new()
        {
            ["id"] = id,
            ["title"] = title,
            ["releaseYear"] = year,
            ["mediaType"] = mediaType,
            ["genres"] = new JsonArray(genres.Select(genre => (JsonNode)genre).ToArray()),
            ["synopsis"] = $"{title}'s synopsis.",
            ["rating"] = rating,
            ["voteCount"] = votes,
            ["runtimeMinutes"] = runtimeMinutes,
            ["trailerUrl"] = trailerUrl,
            ["posterUrl"] = posterUrl,
            ["availability"] = new JsonArray(availability
                .Select(entry => (JsonNode)new JsonObject
                {
                    ["providerId"] = entry.ProviderId,
                    ["deepLinkUrl"] = entry.Link,
                })
                .ToArray()),
        };

    /// <summary>The stored payload for a snapshot of the given titles.</summary>
    protected static string SnapshotPayload(
        string region,
        DateTimeOffset fetchedAt,
        params JsonObject[] titles) =>
        new JsonObject
        {
            ["region"] = region,
            ["fetchedAt"] = fetchedAt,
            ["titles"] = new JsonArray(titles.Cast<JsonNode>().ToArray()),
        }.ToJsonString();

    /// <summary>
    /// A timestamp comfortably inside both windows: fresh enough that a read
    /// does not start a refresh behind it (24 h staleness), recent enough that
    /// the migration may read it (180-day retention).
    ///
    /// Truncated to whole seconds because it is written through <c>timestamptz</c>
    /// (microseconds) and compared to the version row it becomes: a tick-precise
    /// value would make an equality assertion fail on storage rounding rather
    /// than on a defect.
    /// </summary>
    protected static DateTimeOffset Recently() =>
        DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds());

    /// <summary>The first active version, failing the test when there is none.</summary>
    protected async Task<CatalogVersion> ActiveVersionOrFailAsync(string region = "BR")
    {
        var active = await ActiveVersionAsync(region);

        Assert.NotNull(active);

        return active!;
    }
}

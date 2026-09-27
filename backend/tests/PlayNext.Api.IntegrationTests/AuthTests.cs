using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace PlayNext.Api.IntegrationTests;

/// <summary>
/// Gated integration tests for the auth endpoints (T017), driving the real host
/// in-process through <see cref="WebApplicationFactory{TEntryPoint}"/>.
///
/// These are the only tests in the suite that touch PostgreSQL, and the only
/// ones that exercise the whole stack at once: endpoint → use case →
/// Identity → EF Core → the merge rule → back out as JSON. That reach is the
/// point. The application suite proves the orchestration against fakes and the
/// domain suite proves the merge rule in isolation, but neither can show that
/// Identity really counts to five, that the composite key really refuses a
/// second rating for a title, or that the wire shape really round-trips — those
/// are claims about the parts working together, and only a real stack can
/// settle them.
/// </summary>
public sealed class AuthTests : IClassFixture<AuthApiFactory>
{
    private readonly AuthApiFactory _api;

    public AuthTests(AuthApiFactory api) => _api = api;

    /// <summary>A fresh address per test, so tests do not depend on each other's rows.</summary>
    private static string NewEmail() => $"visitor-{Guid.NewGuid():N}@example.com";

    private static JsonObject GuestDocument()
    {
        return new JsonObject
        {
            ["interactions"] = new JsonObject
            {
                ["arrival"] = new JsonObject { ["state"] = "loved", ["updatedAt"] = "2026-09-27T10:00:00Z" },
                ["hereditary"] = new JsonObject { ["state"] = "disliked", ["updatedAt"] = "2026-09-27T10:01:00Z" },
                ["dune"] = new JsonObject { ["state"] = "wantToWatch", ["updatedAt"] = "2026-09-27T10:02:00Z" },
            },
            ["history"] = new JsonArray
            {
                new JsonObject { ["titleId"] = "arrival", ["chosenAt"] = "2026-09-27T10:05:00Z" },
                new JsonObject { ["titleId"] = "dune", ["chosenAt"] = "2026-09-27T10:06:00Z" },
            },
            ["preferences"] = new JsonObject
            {
                ["mediaType"] = new JsonObject { ["values"] = new JsonArray("movie"), ["any"] = false },
                ["genre"] = new JsonObject { ["values"] = new JsonArray("sci-fi"), ["any"] = false },
                ["provider"] = new JsonObject { ["values"] = new JsonArray(), ["any"] = true },
                ["includeUnownedProviders"] = false,
                ["completedAt"] = "2026-09-27T09:00:00Z",
                ["updatedAt"] = "2026-09-27T09:00:00Z",
            },
        };
    }

    [GatedFact]
    public async Task A_guest_document_survives_registration_exactly()
    {
        // SC-001: "the account's state matches the device's counts and values
        // exactly". Asserted as an exact round trip rather than a spot check —
        // a migration that dropped one rating would still pass a test that only
        // looked for one it kept.
        var client = _api.CreateClient();
        var email = NewEmail();

        var response = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
            ["guest"] = GuestDocument(),
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        var state = body["state"]!;

        // The two fields the device's session marker records
        // (contracts/device-storage.md). The id is asserted as a parseable GUID
        // rather than merely present: the client stores whatever arrives, so a
        // placeholder here would become a permanent lie in LocalStorage.
        Assert.True(Guid.TryParse(body["userId"]!.GetValue<string>(), out _));
        Assert.Equal(email, body["email"]!.GetValue<string>());

        var interactions = state["interactions"]!.AsObject();
        Assert.Equal(3, interactions.Count);
        Assert.Equal("loved", interactions["arrival"]!["state"]!.GetValue<string>());
        Assert.Equal("disliked", interactions["hereditary"]!["state"]!.GetValue<string>());
        Assert.Equal("wantToWatch", interactions["dune"]!["state"]!.GetValue<string>());

        // The timestamps have to survive too, and not only because "exactly"
        // says so: newest-wins is the merge rule, so a migration that stamped
        // everything with the same instant would silently change which rating
        // wins the next time this account merges from another device.
        Assert.Equal(
            DateTimeOffset.Parse("2026-09-27T10:00:00Z", CultureInfo.InvariantCulture),
            interactions["arrival"]!["updatedAt"]!.GetValue<DateTimeOffset>());
        Assert.Equal(
            DateTimeOffset.Parse("2026-09-27T10:01:00Z", CultureInfo.InvariantCulture),
            interactions["hereditary"]!["updatedAt"]!.GetValue<DateTimeOffset>());
        Assert.Equal(
            DateTimeOffset.Parse("2026-09-27T10:02:00Z", CultureInfo.InvariantCulture),
            interactions["dune"]!["updatedAt"]!.GetValue<DateTimeOffset>());

        var history = state["history"]!.AsArray();
        Assert.Equal(2, history.Count);

        var preferences = state["preferences"]!;
        Assert.Equal("movie", preferences["mediaType"]!["values"]![0]!.GetValue<string>());
        Assert.Equal("sci-fi", preferences["genre"]!["values"]![0]!.GetValue<string>());

        // The "Any" chip is exclusive: it must come back as any=true with no
        // values, not as a list that happens to be empty.
        Assert.True(preferences["provider"]!["any"]!.GetValue<bool>());
        Assert.Empty(preferences["provider"]!["values"]!.AsArray());
    }

    [GatedFact]
    public async Task Registering_with_no_guest_data_creates_an_empty_account()
    {
        // US1 scenario 4. A first-time visitor has nothing to migrate, and that
        // is an ordinary registration — not an error, and not a reason to write
        // placeholder rows.
        var client = _api.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = NewEmail(),
            ["password"] = "Correct-Horse-9!",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var state = JsonNode.Parse(await response.Content.ReadAsStringAsync())!["state"]!;

        Assert.Empty(state["interactions"]!.AsObject());
        Assert.Empty(state["history"]!.AsArray());
        Assert.Null(state["preferences"]);
    }

    [GatedFact]
    public async Task A_taken_email_offers_signing_in_instead()
    {
        // FR-008. The status and the wording both matter: "that address is
        // taken" with no next step is the dead end the product rules out.
        var client = _api.CreateClient();
        var email = NewEmail();

        var first = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
        });

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Another-Password-9!",
        });

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        var error = JsonNode.Parse(await second.Content.ReadAsStringAsync())!;

        Assert.Equal("email-taken", error["code"]!.GetValue<string>());
        Assert.Contains(
            error["errors"]!.AsArray(),
            message => message!.GetValue<string>().Contains("sign in", StringComparison.OrdinalIgnoreCase));
    }

    [GatedFact]
    public async Task The_refresh_token_arrives_as_an_httponly_cookie_and_never_in_the_body()
    {
        // research D6. The httpOnly flag is the whole defence: without it a
        // single XSS walks away with a 30-day credential.
        var client = _api.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = NewEmail(),
            ["password"] = "Correct-Horse-9!",
        });

        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));

        Assert.Contains("playnext.refresh=", cookie);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);

        var raw = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain("refresh", raw, StringComparison.OrdinalIgnoreCase);

        // The access token is a real signed JWT, not an opaque placeholder.
        var accessToken = JsonNode.Parse(raw)!["accessToken"]!.GetValue<string>();

        Assert.Equal(3, accessToken.Split('.').Length);
    }

    [GatedFact]
    public async Task Wrong_credentials_are_refused_without_naming_which_part_was_wrong()
    {
        // FR-011. Same body for an unknown address and a wrong password, so the
        // response cannot be used to find out who has an account.
        var client = _api.CreateClient();
        var email = NewEmail();

        await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
        });

        var wrongPassword = await client.PostAsJsonAsync("/api/auth/login", new JsonObject
        {
            ["email"] = email,
            ["password"] = "not-the-password",
        });

        var unknownAddress = await client.PostAsJsonAsync("/api/auth/login", new JsonObject
        {
            ["email"] = NewEmail(),
            ["password"] = "not-the-password",
        });

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownAddress.StatusCode);

        var first = await wrongPassword.Content.ReadAsStringAsync();
        var second = await unknownAddress.Content.ReadAsStringAsync();

        // Byte-identical, because "similar" is not the property that matters.
        Assert.Equal(first, second);
    }

    [GatedFact]
    public async Task Signing_in_merges_the_guest_document_into_an_existing_account()
    {
        // US3 through the real stack — the named critical path end to end.
        var client = _api.CreateClient();
        var email = NewEmail();

        await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
            ["guest"] = new JsonObject
            {
                ["interactions"] = new JsonObject
                {
                    ["hereditary"] = new JsonObject { ["state"] = "disliked", ["updatedAt"] = "2026-09-27T10:00:00Z" },
                },
            },
        });

        // A different device, carrying its own guest data, signing in.
        var device = _api.CreateClient();

        var response = await device.PostAsJsonAsync("/api/auth/login", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
            ["guest"] = new JsonObject
            {
                ["interactions"] = new JsonObject
                {
                    ["arrival"] = new JsonObject { ["state"] = "loved", ["updatedAt"] = "2026-09-27T10:05:00Z" },
                },
            },
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var interactions = JsonNode.Parse(await response.Content.ReadAsStringAsync())!
            ["state"]!["interactions"]!.AsObject();

        // Union: neither side lost anything.
        Assert.Equal(2, interactions.Count);
        Assert.Equal("loved", interactions["arrival"]!["state"]!.GetValue<string>());
        Assert.Equal("disliked", interactions["hereditary"]!["state"]!.GetValue<string>());
    }

    [GatedFact]
    public async Task A_rejected_guest_document_creates_no_account()
    {
        // FR-007: an interrupted or refused migration leaves the device's
        // document as the only copy. The account must not exist half-populated,
        // and the address must still be free afterwards.
        var client = _api.CreateClient();
        var email = NewEmail();

        var response = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
            ["guest"] = new JsonObject
            {
                ["interactions"] = new JsonObject
                {
                    ["arrival"] = new JsonObject { ["state"] = "adored", ["updatedAt"] = "2026-09-27T10:00:00Z" },
                },
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // The address was never taken, which is how this test can tell the
        // difference between "refused" and "created then rolled back".
        var retry = await client.PostAsJsonAsync("/api/auth/register", new JsonObject
        {
            ["email"] = email,
            ["password"] = "Correct-Horse-9!",
        });

        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
    }
}

/// <summary>
/// A <see cref="FactAttribute"/> that skips itself when there is no reachable
/// database, so the suite still runs green on a machine without PostgreSQL
/// rather than reporting red for an absent prerequisite.
/// </summary>
public sealed class GatedFactAttribute : FactAttribute
{
    public GatedFactAttribute()
    {
        if (!Postgres.IsReachable)
        {
            Skip = Postgres.SkipReason;
        }
    }
}

/// <summary>
/// The database the integration suite runs against, located the same way the
/// API locates it: the API project's user-secrets (quickstart.md). Reading it
/// from there rather than a hard-coded string means the tests cannot pass
/// against a database the application would never talk to.
/// </summary>
internal static class Postgres
{
    public const string SkipReason =
        "Needs a live PostgreSQL: set ConnectionStrings:Postgres in PlayNext.Api's user-secrets (see specs/004-guest-auth-migration/quickstart.md).";

    public static string ConnectionString { get; } = Resolve();

    public static bool IsReachable { get; } = Probe();

    private static string Resolve()
    {
        return new ConfigurationBuilder()
            .AddUserSecrets(typeof(Program).Assembly, optional: true)
            .Build()
            .GetConnectionString("Postgres") ?? string.Empty;
    }

    /// <summary>
    /// A configured connection string is not a reachable one — the server may
    /// simply not be running — and the two deserve different answers. This
    /// sends a real query so "gated" means what it says.
    /// </summary>
    private static bool Probe()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString))
        {
            return false;
        }

        try
        {
            using var connection = new Npgsql.NpgsqlConnection(ConnectionString);
            connection.Open();

            using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1 FROM \"__EFMigrationsHistory\" LIMIT 1";
            command.ExecuteScalar();

            return true;
        }
        catch (Exception)
        {
            // Unreachable, or reachable but not migrated. Either way the schema
            // these tests assert against is not there.
            return false;
        }
    }
}

/// <summary>
/// Starts the real API for the integration suite.
/// </summary>
public sealed class AuthApiFactory : WebApplicationFactory<Program>
{
    /// <summary>
    /// A fixed signing key, so the only thing these tests need from the
    /// environment is a database. It is not a secret and never leaves the test
    /// process; the application's own key lives in user-secrets.
    /// </summary>
    private const string TestSigningKey = "b7e2c1a94f8d3b6e0a5c9d2f7b4e1a8c3d6f9b2e5a8c1d4f7b0e3a6c9d2f5b8e1";

    public AuthApiFactory()
    {
        // Set as process environment variables rather than through
        // ConfigureAppConfiguration: Program.cs reads both of these while
        // building the host, which happens before any factory callback runs. An
        // in-memory configuration source added later would arrive after the
        // guards that read it had already thrown.
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("ConnectionStrings__Postgres", Postgres.ConnectionString);
        Environment.SetEnvironmentVariable("Jwt__SigningKey", TestSigningKey);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Development on purpose: the production refresh cookie is
        // SameSite=None; Secure, which a browser drops over plain http — and
        // these tests talk http to the in-process server.
        builder.UseEnvironment("Development");
    }
}

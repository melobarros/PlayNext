using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PlayNext.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NormalizedCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CatalogGenres",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TmdbId = table.Column<int>(type: "integer", nullable: true),
                    IsSelectable = table.Column<bool>(type: "boolean", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogGenres", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CatalogServices",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SearchTemplate = table.Column<string>(type: "text", nullable: true),
                    IsQuizService = table.Column<bool>(type: "boolean", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogServices", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CatalogTitleIdentities",
                columns: table => new
                {
                    TitleId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FirstSeenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogTitleIdentities", x => x.TitleId);
                });

            migrationBuilder.CreateTable(
                name: "CatalogVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Region = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FetchedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LatestObservedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogVersions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CatalogServiceProviders",
                columns: table => new
                {
                    TmdbProviderId = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ServiceId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogServiceProviders", x => x.TmdbProviderId);
                    table.ForeignKey(
                        name: "FK_CatalogServiceProviders_CatalogServices_ServiceId",
                        column: x => x.ServiceId,
                        principalTable: "CatalogServices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CatalogRetiredTitles",
                columns: table => new
                {
                    TitleId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false),
                    LastObservedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RetiredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogRetiredTitles", x => x.TitleId);
                    table.ForeignKey(
                        name: "FK_CatalogRetiredTitles_CatalogTitleIdentities_TitleId",
                        column: x => x.TitleId,
                        principalTable: "CatalogTitleIdentities",
                        principalColumn: "TitleId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CatalogRefreshRuns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Region = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    VersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    CountsJson = table.Column<string>(type: "jsonb", nullable: false),
                    FailuresJson = table.Column<string>(type: "jsonb", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogRefreshRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CatalogRefreshRuns_CatalogVersions_VersionId",
                        column: x => x.VersionId,
                        principalTable: "CatalogVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "CatalogTitles",
                columns: table => new
                {
                    VersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TitleId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    ReleaseYear = table.Column<int>(type: "integer", nullable: false),
                    MediaType = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Synopsis = table.Column<string>(type: "text", nullable: false),
                    Rating = table.Column<double>(type: "double precision", nullable: false),
                    VoteCount = table.Column<int>(type: "integer", nullable: false),
                    RuntimeMinutes = table.Column<int>(type: "integer", nullable: true),
                    TrailerUrl = table.Column<string>(type: "text", nullable: true),
                    PosterUrl = table.Column<string>(type: "text", nullable: true),
                    Popularity = table.Column<double>(type: "double precision", nullable: false),
                    InGeneralPool = table.Column<bool>(type: "boolean", nullable: false),
                    PoolPosition = table.Column<int>(type: "integer", nullable: false),
                    LastObservedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogTitles", x => new { x.VersionId, x.TitleId });
                    table.ForeignKey(
                        name: "FK_CatalogTitles_CatalogTitleIdentities_TitleId",
                        column: x => x.TitleId,
                        principalTable: "CatalogTitleIdentities",
                        principalColumn: "TitleId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CatalogTitles_CatalogVersions_VersionId",
                        column: x => x.VersionId,
                        principalTable: "CatalogVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CatalogAvailability",
                columns: table => new
                {
                    VersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TitleId = table.Column<string>(type: "character varying(64)", nullable: false),
                    ServiceId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Region = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    Monetization = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DeepLinkUrl = table.Column<string>(type: "text", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    LastObservedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogAvailability", x => new { x.VersionId, x.TitleId, x.ServiceId, x.Region });
                    table.ForeignKey(
                        name: "FK_CatalogAvailability_CatalogServices_ServiceId",
                        column: x => x.ServiceId,
                        principalTable: "CatalogServices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CatalogAvailability_CatalogTitles_VersionId_TitleId",
                        columns: x => new { x.VersionId, x.TitleId },
                        principalTable: "CatalogTitles",
                        principalColumns: new[] { "VersionId", "TitleId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CatalogTitleGenres",
                columns: table => new
                {
                    VersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TitleId = table.Column<string>(type: "character varying(64)", nullable: false),
                    GenreId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogTitleGenres", x => new { x.VersionId, x.TitleId, x.GenreId });
                    table.ForeignKey(
                        name: "FK_CatalogTitleGenres_CatalogGenres_GenreId",
                        column: x => x.GenreId,
                        principalTable: "CatalogGenres",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CatalogTitleGenres_CatalogTitles_VersionId_TitleId",
                        columns: x => new { x.VersionId, x.TitleId },
                        principalTable: "CatalogTitles",
                        principalColumns: new[] { "VersionId", "TitleId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WatchHistory_TitleId",
                table: "WatchHistory",
                column: "TitleId");

            migrationBuilder.CreateIndex(
                name: "IX_Interactions_TitleId",
                table: "Interactions",
                column: "TitleId");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogAvailability_ServiceId",
                table: "CatalogAvailability",
                column: "ServiceId");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogAvailability_VersionId_LastObservedAt",
                table: "CatalogAvailability",
                columns: new[] { "VersionId", "LastObservedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogAvailability_VersionId_Region_ServiceId_TitleId",
                table: "CatalogAvailability",
                columns: new[] { "VersionId", "Region", "ServiceId", "TitleId" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogAvailability_VersionId_TitleId_Position",
                table: "CatalogAvailability",
                columns: new[] { "VersionId", "TitleId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CatalogGenres_TmdbId",
                table: "CatalogGenres",
                column: "TmdbId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CatalogRefreshRuns_Region_StartedAt",
                table: "CatalogRefreshRuns",
                columns: new[] { "Region", "StartedAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogRefreshRuns_Status",
                table: "CatalogRefreshRuns",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogRefreshRuns_VersionId",
                table: "CatalogRefreshRuns",
                column: "VersionId");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogServiceProviders_ServiceId",
                table: "CatalogServiceProviders",
                column: "ServiceId");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitleGenres_GenreId",
                table: "CatalogTitleGenres",
                column: "GenreId");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitleGenres_VersionId_GenreId_TitleId",
                table: "CatalogTitleGenres",
                columns: new[] { "VersionId", "GenreId", "TitleId" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitleGenres_VersionId_TitleId_Position",
                table: "CatalogTitleGenres",
                columns: new[] { "VersionId", "TitleId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitles_TitleId",
                table: "CatalogTitles",
                column: "TitleId");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitles_VersionId_InGeneralPool_PoolPosition",
                table: "CatalogTitles",
                columns: new[] { "VersionId", "InGeneralPool", "PoolPosition" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitles_VersionId_LastObservedAt",
                table: "CatalogTitles",
                columns: new[] { "VersionId", "LastObservedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitles_VersionId_MediaType_TitleId",
                table: "CatalogTitles",
                columns: new[] { "VersionId", "MediaType", "TitleId" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogTitles_VersionId_Popularity_TitleId",
                table: "CatalogTitles",
                columns: new[] { "VersionId", "Popularity", "TitleId" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogVersions_Region_Active",
                table: "CatalogVersions",
                column: "Region",
                unique: true,
                filter: "\"State\" = 'Active'");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogVersions_Region_Building",
                table: "CatalogVersions",
                column: "Region",
                unique: true,
                filter: "\"State\" = 'Building'");

            migrationBuilder.CreateIndex(
                name: "IX_CatalogVersions_Region_State",
                table: "CatalogVersions",
                columns: new[] { "Region", "State" });

            // Existing ratings and history reference title ids the catalog has
            // never recorded — that is the whole gap this feature closes. The
            // foreign keys below would reject every one of those rows, so the
            // identities they imply are derived from the user data itself
            // before the constraint exists. FirstSeenAt is the earliest instant
            // either row can prove it saw the title, so a migrated identity is
            // at least as old as the record that needed it.
            migrationBuilder.Sql(
                """
                INSERT INTO "CatalogTitleIdentities" ("TitleId", "FirstSeenAt")
                SELECT "seen_id", MIN("seen_at")
                FROM (
                    SELECT "TitleId" AS "seen_id", "UpdatedAt" AS "seen_at" FROM "Interactions"
                    UNION ALL
                    SELECT "TitleId" AS "seen_id", "ChosenAt" AS "seen_at" FROM "WatchHistory"
                ) AS "seen"
                GROUP BY "seen_id"
                ON CONFLICT ("TitleId") DO NOTHING;
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_Interactions_CatalogTitleIdentities_TitleId",
                table: "Interactions",
                column: "TitleId",
                principalTable: "CatalogTitleIdentities",
                principalColumn: "TitleId",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WatchHistory_CatalogTitleIdentities_TitleId",
                table: "WatchHistory",
                column: "TitleId",
                principalTable: "CatalogTitleIdentities",
                principalColumn: "TitleId",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Interactions_CatalogTitleIdentities_TitleId",
                table: "Interactions");

            migrationBuilder.DropForeignKey(
                name: "FK_WatchHistory_CatalogTitleIdentities_TitleId",
                table: "WatchHistory");

            migrationBuilder.DropTable(
                name: "CatalogAvailability");

            migrationBuilder.DropTable(
                name: "CatalogRefreshRuns");

            migrationBuilder.DropTable(
                name: "CatalogRetiredTitles");

            migrationBuilder.DropTable(
                name: "CatalogServiceProviders");

            migrationBuilder.DropTable(
                name: "CatalogTitleGenres");

            migrationBuilder.DropTable(
                name: "CatalogServices");

            migrationBuilder.DropTable(
                name: "CatalogGenres");

            migrationBuilder.DropTable(
                name: "CatalogTitles");

            migrationBuilder.DropTable(
                name: "CatalogTitleIdentities");

            migrationBuilder.DropTable(
                name: "CatalogVersions");

            migrationBuilder.DropIndex(
                name: "IX_WatchHistory_TitleId",
                table: "WatchHistory");

            migrationBuilder.DropIndex(
                name: "IX_Interactions_TitleId",
                table: "Interactions");
        }
    }
}

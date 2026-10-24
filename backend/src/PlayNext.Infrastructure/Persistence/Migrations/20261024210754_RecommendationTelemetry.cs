using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PlayNext.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RecommendationTelemetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecommendationImpressions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientEventId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    TitleId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Surface = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    EngineVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CatalogVersion = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FilterHash = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Score = table.Column<double>(type: "double precision", nullable: false),
                    ReasonCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ShownAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecommendationImpressions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RecommendationActions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientEventId = table.Column<Guid>(type: "uuid", nullable: false),
                    ImpressionId = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DwellMs = table.Column<int>(type: "integer", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecommendationActions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecommendationActions_RecommendationImpressions_ImpressionId",
                        column: x => x.ImpressionId,
                        principalTable: "RecommendationImpressions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationActions_ClientEventId",
                table: "RecommendationActions",
                column: "ClientEventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationActions_ImpressionId",
                table: "RecommendationActions",
                column: "ImpressionId");

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationActions_Kind_ReceivedAt",
                table: "RecommendationActions",
                columns: new[] { "Kind", "ReceivedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationImpressions_ClientEventId",
                table: "RecommendationImpressions",
                column: "ClientEventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationImpressions_ReceivedAt",
                table: "RecommendationImpressions",
                column: "ReceivedAt");

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationImpressions_SessionId_ReceivedAt",
                table: "RecommendationImpressions",
                columns: new[] { "SessionId", "ReceivedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationImpressions_TitleId_ReceivedAt",
                table: "RecommendationImpressions",
                columns: new[] { "TitleId", "ReceivedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RecommendationImpressions_UserId_ReceivedAt",
                table: "RecommendationImpressions",
                columns: new[] { "UserId", "ReceivedAt" },
                filter: "\"UserId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecommendationActions");

            migrationBuilder.DropTable(
                name: "RecommendationImpressions");
        }
    }
}

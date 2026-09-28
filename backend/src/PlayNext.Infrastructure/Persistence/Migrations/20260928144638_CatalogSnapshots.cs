using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PlayNext.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CatalogSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CatalogSnapshots",
                columns: table => new
                {
                    Region = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    FetchedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogSnapshots", x => x.Region);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CatalogSnapshots");
        }
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PlayNext.Infrastructure.Persistence;

/// <summary>
/// Builds a context for the EF Core tools only (<c>dotnet ef migrations add</c>).
///
/// Without this, the tools start the API's host to find a context, which needs
/// every setting a running server needs — including secrets. Generating a
/// migration is a design-time act that touches no database, so it should not
/// require a configured environment; the placeholder connection string below is
/// never opened.
/// </summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=playnext;Username=postgres")
            .Options;

        return new AppDbContext(options);
    }
}

using Microsoft.Extensions.Logging;
using PlayNext.Application.Interfaces;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The slice log line's implementation (contracts/catalog-refresh.md).
///
/// The fields are fixed by the port, so the line can carry counts and timing and
/// nothing else — no title, payload, header, or credential has a way into it
/// (constitution, security standard). Structured parameters rather than string
/// interpolation, so the values stay queryable in the hosting provider's log
/// view.
/// </summary>
public sealed class CatalogRefreshLog(ILogger<CatalogRefreshLog> logger) : ICatalogRefreshLog
{
    /// <inheritdoc />
    public void SliceCompleted(
        string region,
        string slice,
        string status,
        int discovered,
        int fresh,
        int carried,
        int enriched,
        TimeSpan duration)
    {
        logger.LogInformation(
            "Catalog slice {Slice} for {Region} finished {Status} in {DurationMs} ms: "
            + "discovered {Discovered}, fresh {Fresh}, carried {Carried}, enriched {Enriched}.",
            slice,
            region,
            status,
            (long)duration.TotalMilliseconds,
            discovered,
            fresh,
            carried,
            enriched);
    }
}

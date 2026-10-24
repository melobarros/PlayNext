namespace PlayNext.Application.Interfaces;

/// <summary>
/// The one structured log line a completed slice owes the operator
/// (contracts/catalog-refresh.md, "Credential and logging rules").
///
/// A port rather than <c>ILogger</c> directly so the Application layer stays
/// free of framework references (constitution VII), and so the line's fields —
/// region, slice, status, counts, duration, and nothing else — are a type rather
/// than a format string that can grow a title into it.
/// </summary>
public interface ICatalogRefreshLog
{
    void SliceCompleted(
        string region,
        string slice,
        string status,
        int discovered,
        int fresh,
        int carried,
        int enriched,
        TimeSpan duration);

    /// <summary>
    /// A progress update could not be written to the run row. The refresh keeps
    /// going: progress is an account of the run, not part of building it, and the
    /// terminal write is the record that matters.
    /// </summary>
    void ProgressUnavailable(string region);
}

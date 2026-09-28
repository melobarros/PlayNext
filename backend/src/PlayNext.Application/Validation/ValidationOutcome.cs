namespace PlayNext.Application.Validation;

/// <summary>
/// The result of validating a payload: either a value, or the reasons there is
/// none. Never both.
///
/// <see cref="Value"/> is absent when validation fails — there is deliberately no
/// "partially valid" state. A payload that is half-accepted is the failure mode
/// the 002 storage contract names outright: dropping one unrecognized rating
/// silently changes which titles are excluded from the deck, and the visitor has
/// no way to notice. Rejecting the whole request is the honest answer, and
/// <see cref="Errors"/> is what the 400 tells the caller.
/// </summary>
public sealed record ValidationOutcome<T>(T? Value, IReadOnlyList<string> Errors)
{
    /// <summary>An outcome carrying a value.</summary>
    public static ValidationOutcome<T> Valid(T value) => new(value, []);

    /// <summary>A rejection carrying every reason found, not just the first.</summary>
    public static ValidationOutcome<T> Invalid(params string[] errors) => new(default, errors);

    /// <summary>A rejection carrying every reason found, not just the first.</summary>
    public static ValidationOutcome<T> Invalid(IReadOnlyList<string> errors) => new(default, errors);

    /// <summary>Whether a value is present.</summary>
    public bool IsValid => Errors.Count == 0;
}

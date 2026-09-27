namespace PlayNext.Application.Validation;

/// <summary>
/// Shape checks on the credentials themselves.
///
/// Deliberately narrow: this answers "is this a syntactically possible email
/// address", and nothing else. Whether an address is already registered, and
/// whether a password satisfies policy, are both Identity's calls — it owns the
/// uniqueness index and the password policy, and restating either here would
/// create a second rule that can drift from the one actually enforced (FR-008,
/// FR-010).
/// </summary>
public static class CredentialValidator
{
    /// <summary>
    /// Returns the reasons <paramref name="email"/> is not a usable address, or
    /// an empty list when it is. Surrounding whitespace is tolerated — a
    /// trailing space from a phone keyboard is not a different person.
    /// </summary>
    /// <remarks>
    /// Written out rather than delegated to <c>MailAddress</c>, which accepts
    /// forms this API has no use for (display-name syntax) and quietly rejects
    /// others that are perfectly valid. The rule here is the narrow one the
    /// contract needs: one <c>@</c>, something either side, and a dotted domain.
    /// The single message is intentional — telling a caller *which* part of an
    /// address is wrong helps nobody legitimately, and the visitor sees only
    /// "check your email" either way.
    /// </remarks>
    public static IReadOnlyList<string> ValidateEmail(string? email)
    {
        var trimmed = email?.Trim();

        if (string.IsNullOrEmpty(trimmed))
        {
            return ["Enter an email address."];
        }

        var at = trimmed.IndexOf('@');

        if (at < 0 || at != trimmed.LastIndexOf('@'))
        {
            return [Malformed];
        }

        var local = trimmed[..at];
        var domain = trimmed[(at + 1)..];

        if (local.Length == 0
            || domain.Length == 0
            || local.Any(char.IsWhiteSpace)
            || domain.Any(char.IsWhiteSpace)
            || !domain.Contains('.')
            || domain.StartsWith('.')
            || domain.EndsWith('.')
            || domain.StartsWith('-')
            || domain.EndsWith('-'))
        {
            return [Malformed];
        }

        return [];
    }

    private const string Malformed = "That does not look like an email address.";
}

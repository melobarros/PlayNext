namespace PlayNext.Domain;

/// <summary>
/// The region code the catalog is scoped to (FR-005).
///
/// ISO 3166-1 alpha-2, uppercase. The client derives it from the device's
/// language-region and sends it; the server's only job is to refuse anything
/// that is not a region code rather than silently searching the provider for
/// a country that does not exist.
///
/// Deliberately strict about case: "br" is refused rather than quietly
/// uppercased, so a client that starts sending lowercase fails loudly in
/// development instead of silently working until someone changes the rule
/// (contracts/catalog.md).
/// </summary>
public static class CatalogRegion
{
    /// <summary>Whether a value is a well-formed region code.</summary>
    public static bool IsWellFormed(string? region) =>
        region is { Length: 2 }
        && char.IsAsciiLetterUpper(region[0])
        && char.IsAsciiLetterUpper(region[1]);
}

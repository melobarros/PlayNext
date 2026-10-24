using System.Text.Json;
using System.Text.Json.Serialization;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The stored form of a retired title (data-model §10): the wire title with its
/// availability removed.
///
/// It is the same serializer shape the snapshot uses, because an archived title
/// is read by the same <c>ids</c> path that reads the active version and must
/// arrive in the client's shape. Serialization strips availability inside the
/// type, not at each call site: carrying provider carriage data past the
/// retention limit is exactly what the archive exists to avoid, and a caller
/// that forgot would be a silent violation rather than a visible one.
///
/// Reading is total for the same reason as <see cref="CatalogSnapshotJson"/>:
/// an archive row that cannot be read is a title that is simply absent, not a
/// 500 on a watchlist request.
/// </summary>
internal static class CatalogTitleJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new MediaTypeConverter() },
    };

    public static string Serialize(CatalogTitle title) =>
        JsonSerializer.Serialize(title with { Availability = [] }, Options);

    public static CatalogTitle? Deserialize(string payload)
    {
        try
        {
            return JsonSerializer.Deserialize<CatalogTitle>(payload, Options) is { } title
                ? title with { Availability = [] }
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private sealed class MediaTypeConverter : JsonConverter<CatalogMediaType>
    {
        public override CatalogMediaType Read(
            ref Utf8JsonReader reader,
            Type typeToConvert,
            JsonSerializerOptions options) =>
            CatalogMediaTypes.FromWire(reader.GetString())
                ?? throw new JsonException($"'{reader.GetString()}' is not a catalog media type.");

        public override void Write(
            Utf8JsonWriter writer,
            CatalogMediaType value,
            JsonSerializerOptions options) =>
            writer.WriteStringValue(CatalogMediaTypes.ToWire(value));
    }
}

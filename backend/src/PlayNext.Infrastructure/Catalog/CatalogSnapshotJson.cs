using System.Text.Json;
using System.Text.Json.Serialization;
using PlayNext.Application.Contracts;
using PlayNext.Domain;

namespace PlayNext.Infrastructure.Catalog;

/// <summary>
/// The stored form of a snapshot: the one place that knows what a
/// <c>CatalogSnapshots.PayloadJson</c> actually contains.
///
/// The stored bytes are the snapshot the API serves, field for field and name
/// for name — including the media type, which goes through
/// <see cref="CatalogMediaTypes"/> so that <c>jsonb</c> holds <c>"anime"</c>
/// rather than whatever a serializer felt like writing. Keeping one vocabulary
/// is the point: a second spelling would be invisible until someone queried the
/// column and got an answer that did not match the API.
///
/// <b>Reading is total.</b> Any payload that cannot be read comes back as
/// <c>null</c> — absent rather than fatal — because the bytes were written by
/// some other version of this code, and a snapshot that cannot be parsed is a
/// region whose catalog can simply be retrieved again. Throwing here would turn
/// one unreadable row into a 500 on the request path (SC-005).
/// </summary>
internal static class CatalogSnapshotJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new MediaTypeConverter() },
    };

    public static string Serialize(CatalogSnapshot snapshot) =>
        JsonSerializer.Serialize(snapshot, Options);

    /// <summary>
    /// The snapshot a stored payload holds, or <c>null</c> when it does not hold
    /// one.
    /// </summary>
    public static CatalogSnapshot? Deserialize(string payload)
    {
        try
        {
            return JsonSerializer.Deserialize<CatalogSnapshot>(payload, Options);
        }
        catch (JsonException)
        {
            // Well-formed JSON that is not a snapshot: an array where an object
            // belongs, a field of the wrong shape, a media type that is not one
            // of the three. The database's jsonb type catches malformed JSON;
            // this catches everything jsonb is happy to accept.
            return null;
        }
    }

    /// <summary>
    /// Reads and writes the media type in the API's own vocabulary.
    ///
    /// Without this the serializer would store the enum's name — <c>"Anime"</c>
    /// where the API says <c>"anime"</c> — and the payload would stop being the
    /// thing that was served.
    /// </summary>
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

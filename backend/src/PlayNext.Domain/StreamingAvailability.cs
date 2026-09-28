namespace PlayNext.Domain;

/// <summary>
/// One service carrying one title in the visitor's region (data-model.md,
/// "StreamingAvailability").
///
/// The badge is the product's one-tap promise: it exists so a visitor who has
/// decided what to watch is one tap from watching it (FR-007). That is why
/// <see cref="DeepLinkUrl"/> is final — assembled server-side from the
/// service's own search template — rather than something the client builds.
/// </summary>
/// <param name="ProviderId">
/// The service's identity in 001's vocabulary (<c>netflix</c>, <c>mubi</c>, …)
/// for the twelve the quiz offers, and <c>tmdb:{provider_id}</c> for anything
/// else TMDB reports (FR-010). Never dropped and never merged: a service
/// outside the quiz's twelve is still a real place to watch the title, and
/// hiding it would make the catalog less true than the data it came from.
/// </param>
/// <param name="DeepLinkUrl">
/// An absolute URL on the service's own site, searching for this title.
/// PlayNext hosts nothing and proxies nothing.
/// </param>
public sealed record StreamingAvailability(string ProviderId, string DeepLinkUrl);

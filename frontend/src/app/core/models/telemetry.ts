/**
 * The recommendation-event wire vocabulary (009).
 *
 * These are the closed sets the intake validates against
 * (`specs/009-recommendation-telemetry/contracts/recommendation-events.md`) and
 * the shapes it accepts. They live here, in `core/models`, because three
 * layers share them — the ranker produces the reason code, the deck produces
 * the actions, and the transport writes the body — and a union declared twice
 * is a union that will eventually disagree with itself.
 *
 * Names are the wire names, not the app's: the deck's interaction states
 * (`loved`, `wantToWatch`, `watchingNow`…) are a different, wider vocabulary
 * and stay where they are. The deck maps to these; nothing else does.
 */

/** What the visitor did to a card. `undo` reverses the rating it answers. */
export type TelemetryActionKind = 'liked' | 'disliked' | 'skip' | 'watch_now' | 'undo';

/** The branch of the ranker that placed a card. `none` when it placed nothing in particular. */
export type ReasonCode = 'genre-picked' | 'genre-affinity' | 'service' | 'none';

/** Where the card was displayed. `deck` is the only surface today. */
export type TelemetrySurface = 'deck';

/** One card displayed. */
export interface ImpressionEvent {
  /** Generated when the card became current, so a retry carries the same id. */
  clientEventId: string;
  /** The per-tab anonymous session id. */
  sessionId: string;
  titleId: string;
  surface: TelemetrySurface;
  /** One-based position in the deck at display time. */
  position: number;
  /** Which ranking implementation placed the card, e.g. `recommend-v1`. */
  engineVersion: string;
  /** The catalog's `fetchedAt`: which snapshot the card was ranked from. */
  catalogVersion: string;
  /** The filters, as an opaque digest — never the filters themselves. */
  filterHash: string;
  /** The ranker's within-tier score. */
  score: number;
  reasonCode: ReasonCode;
  /** The client's clock, ISO 8601. */
  shownAt: string;
}

/** One visitor response to a displayed card. */
export interface ActionEvent {
  clientEventId: string;
  /** The impression this action answers. */
  impressionClientEventId: string;
  kind: TelemetryActionKind;
  /** From the impression being shown to the action, capped at 300 000. */
  dwellMs: number;
  /** The client's clock, ISO 8601. */
  occurredAt: string;
}

/** One flush. Both arrays may be empty; the intake treats that as a no-op. */
export interface TelemetryBatch {
  impressions: ImpressionEvent[];
  actions: ActionEvent[];
}

/** The intake's 202 body. Never echoed to the visitor — only counted. */
export interface TelemetryResponse {
  accepted: { impressions: number; actions: number };
  duplicates: number;
  unlinked: number;
}

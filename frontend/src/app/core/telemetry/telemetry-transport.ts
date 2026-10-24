import { InjectionToken } from '@angular/core';
import { TelemetryBatch, TelemetryResponse } from '../models/telemetry';

/**
 * What one send attempt produced (009, T031).
 *
 * `status` rather than a success flag, because the service's retry rule is
 * written in status codes: 400 and 413 are permanent, everything else that is
 * not 2xx is worth a retry. A transport that reduced those to booleans would
 * force the service to guess, and guessing is how a validation failure becomes
 * three retries of the same invalid body.
 *
 * A rejected promise means the request never produced a status — the network
 * was down, the request was aborted, the tab was closing. The transport lets
 * that rejection through: it is the service's decision whether a failure is
 * worth retrying, and this layer has no opinion.
 */
export interface TelemetrySendResult {
  status: number;
  body: TelemetryResponse | null;
}

/**
 * How the queue reaches the server.
 *
 * A token rather than a class, so both the service's spec and the deck's can
 * substitute a fake with `{ provide: TELEMETRY_TRANSPORT, useValue: ... }` —
 * and so a test that forgets to cannot silently reach the network, because
 * `providedIn: 'root'` here is the real transport and overriding it is the
 * deliberate, visible act.
 */
export interface TelemetryTransport {
  send(
    batch: TelemetryBatch,
    accessToken: string | null,
    keepalive: boolean,
  ): Promise<TelemetrySendResult>;
}

export const TELEMETRY_TRANSPORT = new InjectionToken<TelemetryTransport>(
  'TelemetryTransport',
  {
    providedIn: 'root',
    // Constructed here rather than registered as `useClass` on an abstract
    // base: the implementation has no dependencies, and a factory keeps the
    // class usable on its own (its spec builds one directly).
    factory: () => new HttpTelemetryTransport(),
  },
);

/** The real transport: one `fetch`, and no judgement about the answer. */
export class HttpTelemetryTransport implements TelemetryTransport {
  async send(
    batch: TelemetryBatch,
    accessToken: string | null,
    keepalive: boolean,
  ): Promise<TelemetrySendResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Attached only when there is a token. An anonymous run must be anonymous
    // on the wire, not merely unstamped on the row: a header the server could
    // read would be enough to link the batch to an account, whatever the
    // request body said.
    if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;

    const response = await fetch('/api/recommendations/events', {
      method: 'POST',
      headers,

      // `keepalive` lets a flush started as the page hides finish after the
      // document is gone. It is set per request rather than per service
      // because only the page-hide flush needs it — a routine flush that keeps
      // the connection alive longer than it has to is just a cost.
      keepalive,
      body: JSON.stringify(batch),
    });

    return { status: response.status, body: await readBody(response) };
  }
}

/**
 * The 202 body, or `null` when there is none to read.
 *
 * Best-effort on purpose: the counts are informational, and a body that fails
 * to parse must not turn a successful send into a failed one. Nothing in the
 * app displays these numbers; the analysis reads the record instead.
 */
async function readBody(response: Response): Promise<TelemetryResponse | null> {
  if (!response.ok) return null;

  try {
    return (await response.json()) as TelemetryResponse;
  } catch {
    return null;
  }
}

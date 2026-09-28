import { Injectable } from '@angular/core';
import { SyncOperation } from '../models/sync';

/**
 * Where a local write announces itself (research D9).
 *
 * The stores keep writing exactly as they did for 001–003; the only thing they
 * gain is one line saying what they just recorded. Nothing about that line
 * mentions accounts, sessions, or HTTP, which is the point — the deck, the
 * watchlist and the quiz still do not know that auth exists, and 004 reaches
 * them through a seam rather than through a rewrite.
 *
 * **Why a service of its own rather than an observable on each store.** The
 * subscriber is `SyncService`, which already depends on the stores to write the
 * canonical state back into the cache. Hanging the sink off the stores would
 * make that a cycle the moment a store wanted to know whether anyone was
 * listening; a third object both sides depend on keeps the arrows pointing one
 * way (constitution VII).
 *
 * Synchronous and unqueued, deliberately. A write that returns before its
 * observers have run would let a caller record a rating and read the account
 * before the push had been sent — and the ordering is the honest one anyway:
 * the local document is already written by the time this fires, so an observer
 * that fails cannot have cost the visitor their change (FR-017).
 *
 * An observer that throws is the observer's problem, and is not caught here.
 * Swallowing it would turn a broken sync into a silent one, and the write that
 * triggered it has already succeeded.
 */
@Injectable({ providedIn: 'root' })
export class WriteSink {
  private readonly observers = new Set<(operation: SyncOperation) => void>();

  /**
   * Starts observing, and returns the function that stops.
   *
   * A returned disposer rather than an `unobserve(observer)` method because the
   * caller that subscribes is the only one that can know when it is done, and
   * holding the disposer is the smallest way to say so.
   */
  observe(observer: (operation: SyncOperation) => void): () => void {
    this.observers.add(observer);

    return () => {
      this.observers.delete(observer);
    };
  }

  /** Announces one recorded decision. Does nothing when nobody is listening. */
  notify(operation: SyncOperation): void {
    for (const observer of this.observers) {
      observer(operation);
    }
  }
}

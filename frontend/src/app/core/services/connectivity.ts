import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * Whether the device currently has a connection (FR-015).
 *
 * **The browser is the only thing that knows.** The service listens to the
 * `online`/`offline` events rather than polling `navigator.onLine` or inferring
 * a state from a request that failed — a failed request proves that one request
 * failed, which is a different claim, and on a flaky connection the two
 * disagree constantly.
 *
 * This is deliberately separate from `CatalogService`'s fallback. Being offline
 * and being unable to reach the provider are related but not the same: a
 * reachable network with an unreachable provider must not tell the visitor
 * their connection is down.
 */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly online = signal(navigator.onLine);

  /** The connection state, as the browser last reported it. */
  readonly isOnline = this.online.asReadonly();

  /** The same fact, read the way the banner needs it. */
  readonly isOffline = computed(() => !this.online());

  constructor() {
    const goOnline = () => this.online.set(true);
    const goOffline = () => this.online.set(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Root services live as long as the app does, so this only ever runs when
    // an injector is torn down early — which is what a test does, and a
    // listener that outlives its test goes on reacting during the next one.
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    });
  }
}

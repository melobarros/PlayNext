import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

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

  private readonly returned = new Subject<void>();

  /**
   * Fires when the connection comes back (FR-017).
   *
   * **The transition, not the state**, and the two are not interchangeable. A
   * caller that has to *act* on the return cannot use `isOnline`, because
   * reading a signal says what is true now and nothing about how it got there —
   * and "the connection is up" is true for every second the app is running, so
   * acting on the level would mean acting always. Watching the signal through
   * an effect instead loses a worse thing: a drop and a return that land in one
   * change-detection pass look like no change at all.
   *
   * The browser's event *is* the transition, and it already arrives here, so
   * this is where it can be handed on without a second listener on the same
   * event — which would be a second place that has to agree about what the
   * browser said.
   */
  readonly cameOnline: Observable<void> = this.returned.asObservable();

  constructor() {
    const goOnline = () => {
      this.online.set(true);
      this.returned.next();
    };
    const goOffline = () => this.online.set(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Root services live as long as the app does, so this only ever runs when
    // an injector is torn down early — which is what a test does, and a
    // listener that outlives its test goes on reacting during the next one.
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      this.returned.complete();
    });
  }
}

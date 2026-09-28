import { TestBed } from '@angular/core/testing';
import { Connectivity } from './connectivity';

/**
 * The connection's state, as the app understands it (FR-015).
 *
 * The service does not poll and does not guess: it listens to the browser's
 * own `online`/`offline` events. That is worth pinning down, because the
 * tempting alternative — reading `navigator.onLine` on a timer, or treating a
 * failed request as proof of being offline — is both wrong and untestable. A
 * failed request proves one request failed; the browser is the only thing that
 * knows whether there is a connection.
 *
 * Events are dispatched by hand. jsdom will not produce a real `offline` event
 * any more than it will produce a real network drop, so the test plays the
 * browser's part — which is also what makes the *handler* the thing under test.
 */
describe('Connectivity', () => {
  let service: Connectivity;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Connectivity);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** What the browser does when the connection drops or returns. */
  function browserReports(state: 'online' | 'offline'): void {
    window.dispatchEvent(new Event(state));
  }

  it('starts from what the browser already knows', () => {
    // Not a hardcoded `true`: a page that loads while offline must not briefly
    // claim to be connected before the first event arrives.
    expect(service.isOnline()).toBe(navigator.onLine);
    expect(service.isOffline()).toBe(!navigator.onLine);
  });

  it('reports offline when the browser says the connection dropped', () => {
    browserReports('offline');

    expect(service.isOffline()).toBe(true);
    expect(service.isOnline()).toBe(false);
  });

  it('reports online again when it comes back', () => {
    browserReports('offline');
    browserReports('online');

    expect(service.isOnline()).toBe(true);
    expect(service.isOffline()).toBe(false);
  });

  /**
   * The transition, not just the state (FR-017).
   *
   * A caller that has to *act* when the connection comes back cannot get that
   * from `isOnline`: reading a signal says what is true now and nothing about
   * how it got there. The sync queue is that caller — it holds changes made
   * while the connection was down, and "the connection is up" is true for every
   * second the app is running, so acting on the level would mean acting always.
   */
  describe('the connection coming back', () => {
    it('announces the return', () => {
      let returns = 0;
      service.cameOnline.subscribe(() => (returns += 1));

      browserReports('offline');
      browserReports('online');

      expect(returns).toBe(1);
    });

    it('says nothing when the connection drops', () => {
      let returns = 0;
      service.cameOnline.subscribe(() => (returns += 1));

      browserReports('offline');

      // The distinction the queue depends on: dropping is not a moment to try
      // sending anything, and a subscriber that could not tell the two apart
      // would spend a request per drop.
      expect(returns).toBe(0);
    });

    it('announces every return, not only the first', () => {
      let returns = 0;
      service.cameOnline.subscribe(() => (returns += 1));

      browserReports('offline');
      browserReports('online');
      browserReports('offline');
      browserReports('online');

      // Three flaky minutes on a train are three chances to send what is
      // queued, and a stream that completed after the first would leave the
      // queue stranded for the rest of the journey.
      expect(returns).toBe(2);
    });
  });

  it('stops listening once it is destroyed', () => {
    // A leaked listener would outlive the injector and keep mutating a
    // torn-down service. Root services only die with the app in production, so
    // the cost here is tests: a listener left behind by one spec would go on
    // reacting during the next one.
    TestBed.resetTestingModule();

    browserReports('offline');

    expect(service.isOffline()).toBe(false);
  });
});

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

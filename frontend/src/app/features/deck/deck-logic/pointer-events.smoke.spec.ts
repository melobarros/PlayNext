/**
 * Environment check for the swipe's DOM binding (002 T001).
 *
 * The deck's gesture maths is a pure function tested with plain values
 * (`swipe.spec.ts`). This spec covers the *other* half: whether this repo's
 * `@angular/build:unit-test` + jsdom can actually deliver pointer events to a
 * listener. Phase 0 research (research.md D11) established the answers in a
 * throwaway install; these assertions pin them to this project's real config,
 * so a jsdom or Vitest upgrade that changes them fails loudly here rather
 * than as a mysterious timeout in the deck's integration test.
 */
describe('pointer event environment', () => {
  it('constructs and dispatches a PointerEvent without a view member', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const received: PointerEvent[] = [];
    target.addEventListener('pointerdown', (event) => received.push(event as PointerEvent));

    // No `view` here — see the next test for why that matters.
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 200,
      clientY: 0,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      isPrimary: true,
    });
    target.dispatchEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0].clientX).toBe(200);
    expect(received[0].pointerId).toBe(1);
    expect(received[0].pointerType).toBe('mouse');
    expect(received[0].buttons).toBe(1);

    target.remove();
  });

  it('throws when `view` is passed — the Vitest-specific trap', () => {
    // Raw jsdom accepts `view: window`; Vitest does not. Angular's own CDK
    // testing helpers work around this by omitting it. Asserting the throw
    // here documents *why* the deck's tests and components never pass it.
    expect(
      () =>
        new PointerEvent('pointerdown', {
          bubbles: true,
          view: window,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
        }),
    ).toThrow();
  });

  it('does not implement pointer capture, so calls must be guarded', () => {
    const target = document.createElement('div');

    // jsdom's pointer-capture PR was closed unmerged (research.md D11), so this
    // is a permanent constraint, not a "wait for the next release". The deck
    // calls `el.setPointerCapture?.(id)`; this pins the reason.
    expect(typeof (target as Element).setPointerCapture).toBe('undefined');

    target.remove();
  });
});

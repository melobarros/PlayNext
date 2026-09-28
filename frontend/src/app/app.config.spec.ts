import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';

/**
 * The app's own provider list, which nothing else checks.
 *
 * This block exists because of a defect that shipped invisibly: `appConfig` had
 * **no `provideHttpClient()` at all**. Every spec passed anyway, because each
 * one configures its own `TestBed` with its own client — so the one provider
 * list that runs in production was the one list no test ever built. That is the
 * shape of the blind spot, and it is not specific to this provider: a spec that
 * supplies what it is testing cannot notice that the app does not.
 *
 * **What the defect actually did is worth stating precisely, because the first
 * guess was wrong.** It does not crash the app. Angular provides
 * `HttpInterceptorHandler` — and through it `HttpClient` — at the root, so
 * injection succeeds with an empty interceptor chain and the app boots happily.
 * Every request then goes out unauthenticated and every 401 goes unhandled,
 * with nothing on screen and nothing in the console to say so. A loud failure
 * would have been found in minutes; this one survived a whole feature.
 *
 * An earlier draft of this file asserted that `TestBed.inject(HttpClient)` does
 * not throw, and it was **worthless**: that assertion cannot fail, because the
 * root-provided handler answers whether or not `appConfig` provides anything.
 * It was deleted rather than kept as reassurance. The test below is the one
 * that can fail, and it fails for the reason that matters.
 */
describe('appConfig', () => {
  beforeEach(() => {
    // `provideHttpClientTesting()` is added *alongside* `appConfig.providers`
    // rather than instead of them: it swaps the backend for a controller and
    // leaves the interceptor chain exactly as `appConfig` registered it, which
    // is the part under test.
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting()],
    });
  });

  it('sends its requests through the session interceptor (FR-015)', () => {
    // The refresh is the observable difference between a client with the
    // interceptor and one without it, and nothing but the interceptor asks for
    // one. This is the assertion that catches `provideHttpClient()` going
    // missing — and its other half, a bare `provideHttpClient()` with the
    // interceptor never registered, which fails the same way and is the more
    // likely edit of the two.
    const http = TestBed.inject(HttpTestingController);

    TestBed.inject(HttpClient)
      .get('/api/me/state')
      .subscribe({ error: () => undefined });

    http.expectOne('/api/me/state').flush(null, { status: 401, statusText: 'Unauthorized' });

    const refresh = http.expectOne('/api/auth/refresh');

    expect(refresh.request.method).toBe('POST');
    expect(refresh.request.headers.get('X-Requested-With')).toBe('playnext');

    refresh.flush(null, { status: 401, statusText: 'Unauthorized' });
  });
});

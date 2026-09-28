import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { sessionInterceptor } from './core/services/session.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The API client, and the one interceptor every call to it goes through:
    // the access token on the way out, the 401 chain on the way back (FR-015).
    //
    // **This line is load-bearing in a way that does not announce itself.**
    // Angular provides `HttpClient` at the root regardless, so removing it does
    // not crash anything — the app boots, and every request succeeds through an
    // implicit client whose interceptor chain is empty. What is lost is silent:
    // no `Authorization` header on `/me/state` or `/me/sync`, and no 401 chain,
    // so a session that has expired looks like a server that stopped answering.
    provideHttpClient(withInterceptors([sessionInterceptor])),
    // `withComponentInputBinding` binds `:titleId` to Match Found's input, so
    // the view declares what it needs and the router supplies it.
    provideRouter(routes, withComponentInputBinding()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

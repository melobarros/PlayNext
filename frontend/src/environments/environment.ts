/**
 * Where the client finds the API, and which Google project it signs in against.
 *
 * Nothing here is a secret. The API base URL is public by nature, and the Google
 * **client ID** is an audience identifier rather than a credential — Google
 * designs it to be shipped in client code. The client *secret* is the credential,
 * and it lives only in the backend's configuration; the constitution forbids
 * provider credentials in client code, and this file is the line that keeps them
 * out.
 *
 * The API's port is fixed by `backend/src/PlayNext.Api/Properties/launchSettings.json`
 * so this value stays stable across runs. Plain http on purpose: the API skips
 * https redirection in Development, because a dev certificate no browser trusts
 * would break every call from the Angular dev server.
 */
export const environment = {
  production: false,

  /** The API's origin plus the contract's `/api` prefix (contracts/api.md). */
  apiBaseUrl: 'http://localhost:5003/api',

  /**
   * The Google OAuth client ID from the Google Cloud console.
   *
   * Empty until the credentials exist (quickstart.md step 3, task T045). Empty
   * is a supported state, not a broken one: the Profile screen hides Google
   * sign-in rather than rendering a button that cannot work, so email/password
   * registration stays fully usable without any Google setup.
   */
  googleClientId: '',
};

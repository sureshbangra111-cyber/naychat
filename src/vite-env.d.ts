/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional API base URL for a split frontend/backend deployment.
   *
   * Leave unset in local development and in a single-origin deployment — Vite
   * proxies /api to the Express server, so the httpOnly session cookies stay
   * same-origin either way.
   *
   * This is a public URL, NOT a secret. No database URI, session secret or
   * admin password is ever exposed through a VITE_* variable.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

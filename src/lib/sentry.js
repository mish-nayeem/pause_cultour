import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN

// No DSN — a local dev build with nothing in .env, say — and every call
// below becomes a safe no-op rather than an error of its own; Sentry's SDKs
// are built to tolerate capture calls before/without init.
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Error monitoring only — no Tracing, Session Replay or Logging. Those
    // add real weight to the bundle every shopper downloads (see main.jsx's
    // admin code-splitting — the same concern applies here) for features
    // this store doesn't need yet, and each has its own separate quota on
    // the free plan regardless.
  })
}

export { Sentry }

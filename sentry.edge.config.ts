import * as Sentry from '@sentry/nextjs'

// Sentry is optional. `enabled: false` still hands the DSN to the SDK, which
// logs "Invalid Sentry Dsn" for an empty or Terraform "TODO-" placeholder — so
// skip init entirely instead. Kept inline (rather than importing
// `configuredEnv`) so this instrumentation file pulls in no app modules.
const dsn = process.env.SENTRY_DSN?.trim()

if (dsn && !/^TODO(?:[-_:]|\b)/i.test(dsn)) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
  })
}

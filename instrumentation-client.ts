import * as Sentry from '@sentry/nextjs'

// Sentry is optional. `enabled: false` still hands the DSN to the SDK, which
// logs "Invalid Sentry Dsn" for an empty/placeholder string — so skip init
// entirely instead. Terraform seeds unset secrets with a "TODO-" prefix.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
const dsnConfigured = Boolean(dsn && !/^TODO(?:[-_:]|\b)/i.test(dsn))

if (dsnConfigured) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.02'),
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

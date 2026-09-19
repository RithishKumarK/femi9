import 'server-only'

/**
 * Tiny structured logger — a single seam for all server-side logging so that
 * output stays machine-parseable and can be forwarded to an aggregator (Sentry)
 * without touching call sites.
 *
 * Each call JSON-stringifies a flat record: { level, event, ...meta, t: ISO }.
 *
 * PII / SECRETS POLICY (do not violate):
 *   Never pass secrets, OTP codes, full card / UPI / bank data, auth tokens,
 *   session cookies, passwords, or raw request/response bodies into `meta`.
 *   Log stable identifiers and short, non-sensitive summaries only (e.g. an
 *   error class string, an event name, a numeric id). Callers are responsible
 *   for redacting before they reach this module — the logger does not scrub.
 */

type Level = 'error' | 'warn' | 'info'

/** Arbitrary structured context. Keep values small and free of PII/secrets. */
type Meta = Record<string, unknown>

function emit(level: Level, event: string, meta?: Meta) {
  const record = {
    level,
    event,
    ...meta,
    t: new Date().toISOString(),
  }

  // Primary sink: structured line to stdout/stderr. Chosen console method keeps
  // the level meaningful for platforms that route by stream/severity.
  const line = JSON.stringify(record)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.info(line)
  }

  if (level === 'error' && process.env.SENTRY_DSN) {
    forwardToSentry(event, meta)
  }
}

/**
 * Secondary sink, loaded ONLY if an app actually ships Sentry.
 *
 * The import is dynamic and the dependency is an OPTIONAL peer, for the same
 * reason `maxmind` is loaded this way in geo/mmdb.ts: this package is shared by
 * three apps and only one of them has Sentry installed. A static import made
 * `@sentry/nextjs` a hard dependency of every app that touches the logger — and
 * since the logger is in the import graph of essentially everything, that meant
 * all of them. It also broke at runtime rather than at build: Sentry's
 * instrumentation pulls `require-in-the-middle`, which Turbopack externalises
 * under a generated name that the standalone bundle could not resolve, so every
 * route in the Lumi9 image answered 500 with a module-not-found.
 *
 * Failure here is swallowed on purpose. This is the error path already; a
 * logger that throws while reporting an error turns a handled failure into an
 * unhandled one, and buries the original.
 */
function forwardToSentry(event: string, meta?: Meta): void {
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.captureMessage(event, { level: 'error', extra: meta })
    })
    .catch(() => {
      // No Sentry in this app's dependency tree. stdout above already has it.
    })
}

export const logger = {
  error(event: string, meta?: Meta) {
    emit('error', event, meta)
  },
  warn(event: string, meta?: Meta) {
    emit('warn', event, meta)
  },
  info(event: string, meta?: Meta) {
    emit('info', event, meta)
  },
}

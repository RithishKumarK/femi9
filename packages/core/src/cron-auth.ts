import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/**
 * Authenticate a scheduled call to a `/api/cron/*` route.
 *
 * EventBridge Scheduler presents `CRON_SECRET` in the `x-cron-secret` header.
 * There is no session behind these requests and there never will be, so the
 * shared secret is the whole control — which is why it is compared in constant
 * time rather than with `===`. A byte-by-byte comparison that returns early
 * leaks the length of the common prefix; over enough requests to an endpoint
 * that generates orders and moves money, that is a secret you can walk.
 *
 * FAILS CLOSED. An unset or `TODO-` prefixed secret means no caller can ever
 * satisfy this, which is the correct outcome: an unauthenticated endpoint that
 * generates renewal orders is worse than one nothing can reach. Terraform seeds
 * `CRON_SECRET` with a placeholder, and `configuredEnv` already treats that as
 * absent everywhere else on the platform.
 */
export function cronSecretOk(req: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim()
  if (!configured || /^TODO(?:[-_:]|\b)/i.test(configured)) return false

  const supplied = req.headers.get('x-cron-secret')
  if (!supplied) return false

  const a = Buffer.from(configured)
  const b = Buffer.from(supplied)
  // timingSafeEqual throws on a length mismatch, and a different length already
  // means "not equal" — so check it first rather than letting it throw.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

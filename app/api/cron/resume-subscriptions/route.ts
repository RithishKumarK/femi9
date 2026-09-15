import { handle, ok, unauthorized } from '@femi9/core/api'
import { requireAdmin } from '@femi9/core/admin-auth'
import { cronSecretOk } from '@femi9/core/cron-auth'
import { resumeDueSkips } from '@femi9/core/services/subscriptions'

/**
 * POST /api/cron/resume-subscriptions — un-pause every plan whose SKIPPED cycle
 * has now passed. Returns { resumed: n }.
 *
 * This exists because Razorpay's Subscriptions API has no skip-one-cycle
 * primitive. "Skip next box" pauses the mandate and stamps `resumeAt` one
 * cadence out; without this job running, that pause is permanent and the
 * customer's plan silently stops after she skips a single delivery — the same
 * class of quiet, expensive failure as an unscheduled `renew-subscriptions`.
 *
 * Only rows that are BOTH paused AND carry a `resumeAt` are touched, so a
 * customer who paused indefinitely is never woken up.
 *
 * Access mirrors the other cron routes: the EventBridge shared secret in
 * `x-cron-secret`, or a signed-in admin for a manual trigger.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    if (!cronSecretOk(req)) {
      const admin = await requireAdmin()
      if (!admin) return unauthorized()
    }
    return ok({ resumed: await resumeDueSkips('femi9') })
  })
}

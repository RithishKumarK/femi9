import { handle, ok, unauthorized } from '@femi9/core/api'
import { requireAdmin } from '@femi9/core/admin-auth'
import { cronSecretOk } from '@femi9/core/cron-auth'
import { generateDueOrders } from '@femi9/core/services/subscriptions'

/**
 * POST /api/cron/renew-subscriptions — generate renewal orders for every due
 * subscription. Returns { generated: n }.
 *
 * In production this is called on a schedule by AWS EventBridge Scheduler, which
 * presents the shared secret in the `x-cron-secret` header. Access is allowed when
 * either:
 *   - CRON_SECRET is set AND the x-cron-secret header matches it (the scheduler), OR
 *   - a signed-in admin is calling it (manual trigger from ops / local dev where no
 *     secret is configured).
 * With no valid secret and no admin session the endpoint is never open.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    // Constant-time, and it treats Terraform's TODO placeholder as unset — the
    // inline `provided === secret` this replaces leaked the common prefix's
    // length on an endpoint that generates orders. See @femi9/core/cron-auth.
    if (!cronSecretOk(req)) {
      const admin = await requireAdmin()
      if (!admin) return unauthorized()
    }

    const generated = await generateDueOrders('femi9')
    return ok({ generated })
  })
}

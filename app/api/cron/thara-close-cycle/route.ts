import type { NextRequest } from 'next/server'
import { handle, ok, unauthorized, badRequest, notFound } from '@femi9/core/api'
import { getAdminSession } from '@femi9/core/admin-auth'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import { closeCycle, currentOpenCycle } from '@femi9/core/services/thara'
import { cronSecretOk } from '@femi9/core/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/cron/thara-close-cycle — close the currently open cycle and
 * issue vouchers. Runs on schedule (EventBridge, first of the quarter) or
 * manually by an admin. Access rules match /api/cron/renew-subscriptions.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()

    // Constant-time, and it treats Terraform's TODO placeholder as unset — the
    // inline `provided === secret` this replaces leaked the common prefix's
    // length. See @femi9/core/cron-auth.
    if (!cronSecretOk(req)) {
      const admin = await getAdminSession()
      if (!admin) return unauthorized()
    }

    const cycle = await currentOpenCycle('femi9')
    if (cycle.status !== 'open') return badRequest('No open cycle to close.')
    const result = await closeCycle('femi9', cycle.id)
    return ok({ cycleId: cycle.id, ...result })
  })
}

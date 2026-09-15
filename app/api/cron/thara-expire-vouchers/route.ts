import type { NextRequest } from 'next/server'
import { handle, ok, unauthorized, notFound } from '@femi9/core/api'
import { getAdminSession } from '@femi9/core/admin-auth'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import { expireStaleVouchers } from '@femi9/core/services/thara'
import { cronSecretOk } from '@femi9/core/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/cron/thara-expire-vouchers — batch-expire past-deadline vouchers.
 *  Same access rules as thara-close-cycle. */
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

    const expired = await expireStaleVouchers('femi9')
    return ok({ expired })
  })
}

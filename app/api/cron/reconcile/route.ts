import { handle, ok, unauthorized } from '@femi9/core/api'
import { requireAdmin } from '@femi9/core/admin-auth'
import { cronSecretOk } from '@femi9/core/cron-auth'
import { reconcilePendingOrders } from '@femi9/core/services/checkout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    // Constant-time, and it treats Terraform's TODO placeholder as unset — the
    // inline `supplied !== configured` this replaces leaked the common prefix's
    // length. See @femi9/core/cron-auth.
    if (!cronSecretOk(req)) {
      const admin = await requireAdmin()
      if (!admin) return unauthorized()
    }
    return ok(await reconcilePendingOrders('femi9'))
  })
}

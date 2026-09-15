import { handle, notFound, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { getForUser } from '@femi9/core/services/affiliate'

export const dynamic = 'force-dynamic'

/** Owner-scoped affiliate metrics. A shareable promo code is not authentication. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser('femi9')
    if (!user) return unauthorized()
    const stats = await getForUser('femi9', user.sub)
    if (!stats) return notFound('No approved affiliate account was found.')
    return ok(stats)
  })
}

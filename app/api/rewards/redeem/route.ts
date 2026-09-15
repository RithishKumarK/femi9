import type { NextRequest } from 'next/server'
import { ok, badRequest, unauthorized, handle } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { redeem, InsufficientPointsError, RewardOptionNotFoundError } from '@femi9/core/services/rewards'

// Node runtime: the redeem path mints a coupon code with node:crypto. Dynamic
// because it both reads the session cookie and writes to the DB per request.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/rewards/redeem — { rewardOptionId } → issue a coupon for the reward,
 * debiting the signed-in customer's Bloom points. Returns { couponCode } on
 * success, or 400 when the balance is short / the reward id is stale.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser('femi9')
    if (!user) return unauthorized()

    const body = (await req.json().catch(() => ({}))) as { rewardOptionId?: unknown }
    const rewardOptionId = typeof body.rewardOptionId === 'string' ? body.rewardOptionId.trim() : ''
    if (!rewardOptionId) return badRequest('Choose a reward to redeem.')

    try {
      const { couponCode } = await redeem('femi9', user.sub, rewardOptionId)
      return ok({ couponCode })
    } catch (err) {
      // Both are expected client-side conditions, not server faults.
      if (err instanceof InsufficientPointsError || err instanceof RewardOptionNotFoundError) {
        return badRequest(err.message)
      }
      throw err
    }
  })
}

import { handle, ok, unauthorized, notFound, badRequest } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import { claimVoucher, TharaVoucherNotClaimableError } from '@femi9/core/services/thara'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/thara/vouchers/[id]/claim — customer marks their voucher claimed. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()
    const session = await getSession('femi9')
    if (!session) return unauthorized()

    const { id } = await ctx.params
    try {
      const v = await claimVoucher('femi9', id, session.sub)
      return ok({ voucher: v })
    } catch (e) {
      if (e instanceof TharaVoucherNotClaimableError) return badRequest(e.message)
      throw e
    }
  })
}

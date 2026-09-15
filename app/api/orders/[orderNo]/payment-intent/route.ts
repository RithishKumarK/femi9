import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, handle, notFound, ok, serviceUnavailable } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { prisma } from '@/lib/db'
import { verifyOrderToken } from '@femi9/core/order-token'
import { clientIp, rateLimit, tooManyRequests } from '@femi9/core/rate-limit'
import { ProviderConfigurationError } from '@femi9/core/runtime-mode'
import {
  OrderNotFoundError,
  OrderNotPayableError,
  PaymentAmountMismatchError,
  PaymentIntentMissingError,
  pendingPaymentIntent,
} from '@femi9/core/services/checkout'

export const dynamic = 'force-dynamic'

const Body = z.object({ token: z.string().optional().default('') })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const hit = await rateLimit(`payment-retry:${clientIp(req)}`, 10, 60_000)
  if (!hit.ok) return tooManyRequests(hit.retryAfterSec)

  return handle(async () => {
    const { orderNo } = await params
    const parsed = Body.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return badRequest('Invalid request')

    const order = await prisma.order.findUnique({
      where: { orderNo },
      select: { userId: true },
    })
    if (!order) return notFound()

    let authorized = verifyOrderToken(orderNo, parsed.data.token)
    if (!authorized && order.userId) {
      const session = await getSession('femi9')
      authorized = session?.sub === order.userId
    }
    // Hide whether an order number exists when the caller does not own it.
    if (!authorized) return notFound()

    try {
      return ok({ payment: await pendingPaymentIntent('femi9', orderNo) })
    } catch (err) {
      if (err instanceof OrderNotFoundError) return notFound()
      if (
        err instanceof OrderNotPayableError ||
        err instanceof PaymentIntentMissingError ||
        err instanceof PaymentAmountMismatchError
      ) {
        return badRequest(err.message)
      }
      if (err instanceof ProviderConfigurationError) {
        return serviceUnavailable('Online payment is temporarily unavailable.')
      }
      throw err
    }
  })
}

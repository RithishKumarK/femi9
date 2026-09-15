import { z } from 'zod'
import { ok, badRequest, notFound, handle } from '@femi9/core/api'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { submitQuestion, ProductNotFoundError } from '@femi9/core/services/questions-public'

/**
 * POST /api/questions — "Ask a question" from the product page.
 *
 * Public, like review submission: requiring an account to ask whether a pad
 * suits heavy flow would lose the question. The answer comes back by email, so
 * an address is the one required field a review does not have.
 */

const bodySchema = z.object({
  productSlug: z.string().min(1),
  name: z.string().min(1).max(80),
  email: z.string().email().max(160),
  question: z.string().min(1).max(2000),
})

export async function POST(req: Request) {
  return handle(async () => {
    // Three an hour per address. This one sends mail to a human inbox, so the
    // limit is tighter than review submission's five a minute.
    const rl = await rateLimit(`questions:${clientIp(req)}`, 3, 3_600_000)
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return badRequest('Invalid question', parsed.error.flatten())

    const { productSlug, name, email, question } = parsed.data
    try {
      const { sent } = await submitQuestion('femi9', productSlug, { name, email, question })
      // `sent: false` means our mail provider or support address is
      // misconfigured — the attempt is logged in NotificationLog either way, and
      // the client shows the same acknowledgement. Surfacing an error here would
      // invite the shopper to retry something only we can fix.
      return ok({ ok: true, sent })
    } catch (err) {
      if (err instanceof ProductNotFoundError) return notFound('Product not found')
      throw err
    }
  })
}

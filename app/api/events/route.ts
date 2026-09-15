import { z } from 'zod'
import { ok, badRequest, handle } from '@femi9/core/api'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { logEvent } from '@femi9/core/services/events'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  type: z.string().min(1),
  // meta is a free-form JSON bag of context (product id, source, etc.).
  meta: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: Request) {
  return handle(async () => {
    const rl = await rateLimit(`events:${clientIp(req)}`, 30, 60_000)
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return badRequest('Invalid event payload', parsed.error.flatten())
    }

    await logEvent('femi9', { type: parsed.data.type, meta: parsed.data.meta })
    return ok({ ok: true })
  })
}

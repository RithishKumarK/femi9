import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, created, handle } from '@femi9/core/api'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { apply } from '@femi9/core/services/affiliate'

/**
 * POST /api/affiliate/apply — a creator submits the program application.
 *
 * We only ever return an acknowledgement: no code is issued at apply time (an
 * admin approves and allocates it later), so the response is intentionally
 * contentless beyond `{ ok: true }`. The storefront shows "we'll email your code".
 */

// Empty optional text fields arrive as '' from the form; normalise to undefined
// so `.optional()` accepts a box the applicant simply left blank.
const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const ApplySchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  handle: z.string().trim().min(1, 'Please add your social handle').max(60),
  platform: z.preprocess(blankToUndef, z.string().trim().max(80).optional()),
  followerBand: z.preprocess(blankToUndef, z.string().trim().max(40).optional()),
  email: z.string().trim().email('Enter a valid email').max(200),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = await rateLimit(`affiliate-apply:${clientIp(req)}`, 5, 300_000)
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

    const raw = await req.json().catch(() => null)
    const parsed = ApplySchema.safeParse(raw)
    if (!parsed.success) return badRequest('Please fix the errors below', parsed.error.flatten())

    await apply('femi9', parsed.data)
    return created({ ok: true })
  })
}

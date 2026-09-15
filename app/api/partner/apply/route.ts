import { z } from 'zod'
import { ok, badRequest, handle } from '@femi9/core/api'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { createApplication } from '@femi9/core/services/partner'

/**
 * /api/partner/apply — public "become a partner" lead capture.
 *   POST → validate the form and create a PartnerApplication (status `new`).
 * No auth: this is the storefront form. The admin CRM reads/works the leads.
 */

export const dynamic = 'force-dynamic'

const ApplySchema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name.').max(120),
  // 10-digit Indian mobile — the storefront strips non-digits before posting,
  // but re-assert it here since the route is the authoritative boundary.
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter a 10-digit mobile number.'),
  city: z.string().trim().max(120).optional().default(''),
  situation: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(2000).optional(),
})

export async function POST(req: Request) {
  return handle(async () => {
    const rl = await rateLimit(`partner-apply:${clientIp(req)}`, 5, 300_000)
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

    const json = await req.json().catch(() => null)
    const parsed = ApplySchema.safeParse(json)
    if (!parsed.success) {
      return badRequest('Please fix the errors below', parsed.error.flatten())
    }

    const { name, phone, city, situation, reason } = parsed.data
    await createApplication('femi9', { name, phone, city, situation, reason })
    return ok({ ok: true })
  })
}

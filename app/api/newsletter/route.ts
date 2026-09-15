import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, created, handle, ok } from '@femi9/core/api'
import { prisma } from '@/lib/db'
import { clientIp, rateLimit, tooManyRequests } from '@femi9/core/rate-limit'

/**
 * POST /api/newsletter — persist a journal / footer signup.
 *
 * Both forms used to be pure theatre: the footer discarded the address and
 * showed "Thanks! You are on the list", and the Blog form flipped a boolean on
 * an uncontrolled input whose value was never read. Every address a shopper
 * gave the brand was thrown away while she was told she was subscribed.
 *
 * Re-subscribing is idempotent (email is @unique) and answers 200 rather than a
 * conflict — from the visitor's side "you are on the list" is simply true, and
 * a 409 would leak which addresses are already subscribed.
 */
const Schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  source: z.enum(['footer', 'journal']).optional(),
})

export async function POST(req: NextRequest) {
  // Two buckets, same shape as the OTP routes: one per IP so a single client
  // cannot flood the table, one per address so a shared NAT does not lock out
  // an office. Cheap insert, so the limits are generous.
  const ipHit = await rateLimit('newsletter:ip:' + clientIp(req), 10, 60_000)
  if (!ipHit.ok) return tooManyRequests(ipHit.retryAfterSec)

  return handle(async () => {
    const parsed = Schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return badRequest('Enter a valid email address.', parsed.error.flatten())
    }
    const { email, source } = parsed.data

    const addrHit = await rateLimit('newsletter:addr:' + email, 5, 3_600_000)
    if (!addrHit.ok) return tooManyRequests(addrHit.retryAfterSec)

    const existing = await prisma.newsletterSubscriber.findUnique({
      where: { email },
      select: { id: true },
    })
    if (existing) return ok({ ok: true, alreadySubscribed: true })

    await prisma.newsletterSubscriber.create({ data: { email, source: source ?? null } })
    return created({ ok: true, alreadySubscribed: false })
  })
}

import { handle, ok, unauthorized, notFound } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { getMembership, syncTharaActivation } from '@femi9/core/services/thara'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()

    const session = await getSession('femi9')
    if (!session) return unauthorized()

    // Same self-heal as /summary: a membership whose qualifying order predates
    // enrolment is promoted before we report its status.
    await syncTharaActivation('femi9', session.sub)

    const m = await getMembership('femi9', session.sub)
    if (!m) return ok({ enrolled: false })

    const incomingRef = await prisma.tharaReferral.findUnique({
      where: { referredUserId: session.sub },
      include: { referrer: { select: { referralCode: true } } },
    })
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? ''
    return ok({
      enrolled: true,
      status: m.status,
      referralCode: m.referralCode,
      referralUrl: base ? `${base}/r/${m.referralCode}` : null,
      enrolledAt: m.enrolledAt,
      activatedAt: m.activatedAt,
      referrerCode: incomingRef?.referrer.referralCode ?? null,
    })
  })
}

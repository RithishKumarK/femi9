import { badRequest, handle, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { getCycleData, setCycleConsent } from '@femi9/core/services/cycle'
import { z } from 'zod'

/**
 * GET /api/cycle — the signed-in user's computed cycle model (same shape the
 * dashboard renders). Per-user and cookie-gated, so it must never be cached.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    return ok(await getCycleData('femi9', u.sub))
  })
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    const parsed = z.object({ consent: z.boolean() }).safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid consent setting')
    await setCycleConsent('femi9', u.sub, parsed.data.consent)
    return ok({ consent: parsed.data.consent })
  })
}

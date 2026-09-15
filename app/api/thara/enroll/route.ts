import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { handle, ok, unauthorized, notFound, badRequest } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { enrollUser, TharaDeactivatedError } from '@femi9/core/services/thara'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import { THARA_TERMS_VERSION } from '@/lib/thara/terms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ termsVersion: z.string().min(1) })

export async function POST(req: NextRequest) {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()

    const session = await getSession('femi9')
    if (!session) return unauthorized()

    const raw = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return badRequest('Invalid body', parsed.error.format())
    if (parsed.data.termsVersion !== THARA_TERMS_VERSION) {
      return badRequest('Please accept the latest Thara terms.', {
        current: THARA_TERMS_VERSION,
      })
    }

    try {
      const membership = await enrollUser('femi9', session.sub, parsed.data.termsVersion)
      return ok(membership)
    } catch (e) {
      if (e instanceof TharaDeactivatedError) return badRequest(e.message)
      throw e
    }
  })
}

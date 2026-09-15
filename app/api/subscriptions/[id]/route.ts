import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, handle, notFound, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { pause, resume, skipNext, cancel } from '@femi9/core/services/subscriptions'

/**
 * Manage a single subscription.
 *   PATCH { action: 'pause' | 'resume' | 'skip' | 'cancel' }
 *
 * Customer-guarded AND ownership-checked: the service scopes every mutation by
 * { id, userId }, so a request for someone else's subscription comes back as a 404
 * (not owned ⇒ indistinguishable from missing). In Next 14.2 route-handler `params`
 * is a plain object.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  action: z.enum(['pause', 'resume', 'skip', 'cancel']),
})

// Map each action to its service call. Keeps the handler a straight lookup.
const ACTIONS = { pause, resume, skip: skipNext, cancel } as const

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    const subscription = await ACTIONS[parsed.data.action]('femi9', params.id, u.sub)
    if (!subscription) return notFound('Subscription not found')
    return ok({ subscription })
  })
}

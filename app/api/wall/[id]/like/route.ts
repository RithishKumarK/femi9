import type { NextRequest } from 'next/server'
import { handle, notFound, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { likePost } from '@femi9/core/services/wall'

/**
 * /api/wall/[id]/like — POST increments a post's like count.
 * Next 14.2: `params` is a plain synchronous object, not a Promise.
 *
 * The guest cookie is passed through for parity with the service signature, but
 * guests have no durable identity so likes aren't deduped (see likePost).
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handle(async () => {
    const user = await requireUser('femi9')
    if (!user) return unauthorized()
    const result = await likePost('femi9', params.id, user.sub)
    // null → post missing or not approved (can't like a pending/hidden story).
    if (result === null) return notFound('Post not found')
    return ok(result)
  })
}

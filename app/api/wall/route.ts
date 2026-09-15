import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, created, handle, ok } from '@femi9/core/api'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import { createPost, listApprovedPosts } from '@femi9/core/services/wall'

/**
 * /api/wall — the public community wall.
 *   GET  → approved posts, newest first (the storefront feed).
 *   POST → create a submission. It lands as `pending`, so the response only
 *          acknowledges receipt; the new post is NOT returned into the feed
 *          (it won't be visible until a moderator approves it).
 */

const CreateSchema = z.object({
  // Real name (named posts) or absent (anonymous). Trimmed; empty coerced away.
  alias: z.string().trim().max(40).optional(),
  isAnonymous: z.boolean().default(false),
  // A real catalog product id (rarely used by guests) …
  productId: z.string().min(1).optional(),
  // … or the free-text "what did you use?" label from the compose chips.
  product: z.string().trim().max(60).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  body: z.string().trim().min(1, 'A story is required').max(600),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
})

/** GET /api/wall — approved posts for the storefront feed. */
export async function GET() {
  return handle(async () => ok(await listApprovedPosts('femi9')))
}

/** POST /api/wall — submit a story (moderated: created as `pending`). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = await rateLimit(`wall:${clientIp(req)}`, 5, 60_000)
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

    const raw = await req.json().catch(() => null)
    const parsed = CreateSchema.safeParse(raw)
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    await createPost('femi9', parsed.data)
    // Deliberately don't echo the post back — it's pending review, not live.
    return created({ ok: true, status: 'pending' })
  })
}

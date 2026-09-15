import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ok, badRequest, notFound, conflict, handle } from '@femi9/core/api'
import { rateLimit, clientIp, tooManyRequests } from '@femi9/core/rate-limit'
import {
  voteOnReview,
  AlreadyVotedError,
  ReviewNotFoundError,
} from '@femi9/core/services/reviews-public'
import { getSession } from '@femi9/core/auth'

/**
 * POST /api/reviews/:id/vote — "was this review helpful?" from the product page.
 *
 * Public by design: requiring an account to say a review was useful would
 * collect almost no signal. One vote per visitor per review is enforced in the
 * database (see `voteOnReview`), keyed by user id when we have a session and by
 * a hashed IP otherwise.
 */

const bodySchema = z.object({ helpful: z.boolean() })

/**
 * The identity a vote is attributed to.
 *
 * The IP is HASHED, never stored raw: this table would otherwise become a log of
 * which address read which product review, which is a far more sensitive record
 * than the vote it exists to deduplicate. A session id is used in preference so
 * a signed-in shopper's vote survives her changing networks.
 */
function voterKey(req: Request, userId?: string): string {
  if (userId) return `u:${userId}`
  return `ip:${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 32)}`
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    // Deliberately tighter than the submission limiter: a vote is one tap, so a
    // burst of them is a script, not a shopper making up her mind.
    const rl = await rateLimit(`review-vote:${clientIp(req)}`, 20, 60_000)
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec)

    const { id } = await params
    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return badRequest('Invalid vote', parsed.error.flatten())

    const session = await getSession('femi9')
    try {
      const tallies = await voteOnReview('femi9', id, voterKey(req, session?.sub), parsed.data.helpful)
      return ok(tallies)
    } catch (err) {
      if (err instanceof ReviewNotFoundError) return notFound('Review not found')
      // The client keeps its own record of what it has voted on, so this is the
      // backstop for a cleared store or a second device — not the common path.
      if (err instanceof AlreadyVotedError) {
        return conflict('You have already voted on this review', { code: 'already_voted' })
      }
      throw err
    }
  })
}

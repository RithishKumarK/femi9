import 'server-only'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Storefront-facing review service — the write counterpart to getProduct()'s read
 * path (which only surfaces `approved` rows). Shopper submissions land here as
 * `pending` so nothing goes live until a moderator triages it in the admin queue.
 *
 * Kept separate from `services/admin/reviews.ts`: that module is the moderator
 * side (list/approve/hide/delete) and must never be reachable from public code.
 */

/** One photo or video the shopper attached with their review. Uploaded to the
 *  shared uploads bucket by /api/reviews/upload before the review submit call,
 *  which persists the array on Review.media. */
export interface ReviewMedia {
  url: string
  kind: 'image' | 'video'
}

export interface ReviewInput {
  name: string
  place?: string
  rating: number
  /** Optional one-line headline shown above the body on the product card. */
  title?: string
  body: string
  /** Optional photos + short clips shown with the review once approved. */
  media?: ReviewMedia[]
}

/**
 * Thrown when the slug doesn't resolve to a product. Typed so the route can map
 * it to a 404 while any other failure still bubbles up as a 500.
 */
export class ProductNotFoundError extends Error {
  constructor(slug: string) {
    super(`Product not found: ${slug}`)
    this.name = 'ProductNotFoundError'
  }
}

/**
 * Create a `pending` review for the product identified by `slug`.
 *
 * A Review references its product by internal id, not slug, so we resolve the
 * slug first and reject unknown ones. `status: 'pending'` is set explicitly to
 * override the schema default (`approved`) — shopper submissions must be moderated
 * before they appear on the product page.
 */
export async function submitReview(brand: Brand, productSlug: string, input: ReviewInput, userId?: string): Promise<void> {
  const prisma = dbFor(brand)
  const product = await prisma.product.findUnique({
    where: { slug: productSlug },
    select: { id: true },
  })
  if (!product) throw new ProductNotFoundError(productSlug)

  await prisma.$transaction(async (tx) => {
    const priorReview = userId
      ? await tx.review.findFirst({ where: { userId, productId: product.id }, select: { id: true } })
      : null
    const purchased = userId
      ? await tx.order.findFirst({
          where: { userId, status: { in: ['paid', 'processing', 'shipped', 'delivered'] }, items: { some: { variant: { productId: product.id } } } },
          select: { id: true },
        })
      : null
    await tx.review.create({
      data: {
        productId: product.id,
        userId,
        name: input.name,
        place: input.place,
        rating: input.rating,
        title: input.title,
        body: input.body,
        status: 'pending',
        // Media rows arrive already uploaded (URLs pointing at
        // /uploads/lumi9/reviews/…) — the service just persists the array.
        // Null when the shopper submitted nothing; the storefront treats null
        // and [] the same way.
        media: input.media && input.media.length > 0 ? (input.media as unknown as object[]) : undefined,
      },
    })
    if (userId && purchased && !priorReview) {
      const balance = await tx.pointsLedger.aggregate({ where: { userId }, _sum: { delta: true } })
      await tx.pointsLedger.create({
        data: { userId, delta: 50, reason: `Product review: ${product.id}`, balanceAfter: (balance._sum.delta ?? 0) + 50 },
      })
    }
  })
}

/**
 * Thrown when a voter has already voted on this review. Typed so the route can
 * answer 409 rather than silently letting a refresh inflate the tally.
 */
export class AlreadyVotedError extends Error {
  constructor() {
    super('Already voted on this review')
    this.name = 'AlreadyVotedError'
  }
}

/** Thrown when the review id does not resolve to an approved review. */
export class ReviewNotFoundError extends Error {
  constructor(id: string) {
    super(`Review not found: ${id}`)
    this.name = 'ReviewNotFoundError'
  }
}

/**
 * Record one helpful / not-helpful vote and return the new tallies.
 *
 * The ReviewVote insert and the counter bump share a transaction, so the
 * denormalised totals on Review can never drift from the rows that justify
 * them. The unique constraint on (reviewId, voterKey) is what actually enforces
 * "vote once" — we let the insert fail rather than checking first, because a
 * check-then-insert races with itself under concurrent taps.
 *
 * Only `approved` reviews are votable: a pending row is not visible on the
 * storefront, so a vote for one could only have come from a forged id.
 */
export async function voteOnReview(brand: Brand, 
  reviewId: string,
  voterKey: string,
  helpful: boolean,
): Promise<{ helpfulUp: number; helpfulDown: number }> {
  const prisma = dbFor(brand)
  const review = await prisma.review.findFirst({
    where: { id: reviewId, status: 'approved' },
    select: { id: true },
  })
  if (!review) throw new ReviewNotFoundError(reviewId)

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.reviewVote.create({ data: { reviewId, voterKey, helpful } })
      const updated = await tx.review.update({
        where: { id: reviewId },
        data: helpful ? { helpfulUp: { increment: 1 } } : { helpfulDown: { increment: 1 } },
        select: { helpfulUp: true, helpfulDown: true },
      })
      return updated
    })
  } catch (err) {
    // P2002 = unique constraint violation, i.e. this voterKey already voted.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      throw new AlreadyVotedError()
    }
    throw err
  }
}

/** A moderated review, shaped for the landing testimonial carousel. */
export interface FeaturedReview {
  id: string
  name: string
  place: string | null
  rating: number
  quote: string
  productName: string
}

/**
 * Approved reviews for the landing carousel.
 *
 * The landing page shipped four hardcoded quotes — one of which ("Make The
 * Switch This Month") was not even a person's name — while a moderated Review
 * table with real customer words sat unread. Only 4- and 5-star reviews are
 * eligible: this is a testimonial rail, not the product's rating summary, which
 * lives on the PDP and shows everything.
 */
export async function listFeaturedReviews(brand: Brand, limit = 6): Promise<FeaturedReview[]> {
  const prisma = dbFor(brand)
  const rows = await prisma.review.findMany({
    where: { status: 'approved', rating: { gte: 4 } },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(24, limit)),
    select: {
      id: true,
      name: true,
      place: true,
      rating: true,
      body: true,
      product: { select: { name: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    place: r.place,
    rating: r.rating,
    // Testimonial cards are a fixed height; a long review is trimmed on a word
    // boundary rather than mid-word.
    quote: r.body.length > 120 ? r.body.slice(0, r.body.lastIndexOf(' ', 117)) + '…' : r.body,
    productName: r.product.name,
  }))
}

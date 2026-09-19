import 'server-only'
import { Prisma } from '@prisma/client'
import type { ModerationStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Admin reviews service — the moderation-side counterpart to the storefront read
 * path (which only ever surfaces `approved` reviews). Moderators see EVERY row
 * regardless of status so pending submissions can be triaged and abusive ones
 * hidden or removed.
 *
 * Rows are shaped for the client here (product name flattened in, `createdAt`
 * serialised to an ISO string) so the moderation queue — a client component —
 * can consume them straight from JSON without touching this `server-only` module.
 */

export type ReviewRow = {
  id: string
  productId: string
  productName: string
  name: string
  place: string | null
  rating: number
  /** Optional headline. Shown here because a moderator approves everything that
   *  will publish, and the title publishes above the body. */
  title: string | null
  body: string
  status: ModerationStatus
  createdAt: string // ISO 8601 — Dates aren't JSON-serialisable to the client.
  /** Photos + short clips the reviewer attached. Empty when they attached
   *  none. Shown as thumbnails in the moderation queue so an operator does
   *  not have to open a separate view to decide whether to approve. */
  media: { url: string; kind: 'image' | 'video' }[]
}

// The exact query payload, so `toRow` stays type-checked against the include.
type ReviewWithProduct = Prisma.ReviewGetPayload<{
  include: { product: { select: { name: true } } }
}>

function toRow(r: ReviewWithProduct): ReviewRow {
  return {
    id: r.id,
    productId: r.productId,
    productName: r.product.name,
    name: r.name,
    place: r.place,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    media: normalizeMedia(r.media),
  }
}

/** Same shape guard as the storefront's normaliser — kept local rather than
 *  re-exported to keep admin server code independent of the storefront service. */
function normalizeMedia(raw: unknown): { url: string; kind: 'image' | 'video' }[] {
  if (!Array.isArray(raw)) return []
  const out: { url: string; kind: 'image' | 'video' }[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const url = (entry as { url?: unknown }).url
    const kind = (entry as { kind?: unknown }).kind
    if (typeof url !== 'string' || (kind !== 'image' && kind !== 'video')) continue
    out.push({ url, kind })
  }
  return out
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** All reviews (optionally filtered by status), newest first, with product name. */
export async function listReviews(brand: Brand, {
  status,
}: { status?: ModerationStatus } = {}): Promise<ReviewRow[]> {
  const prisma = dbFor(brand)
  try {
    const rows = await prisma.review.findMany({
      // Omit the filter entirely when no status is given so the query planner sees
      // a plain "all rows" read rather than `status IN (…)`.
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { name: true } } },
    })

    return rows.map(toRow)
  } catch {
    return []
  }
}

// ─────────────────────────────── Writes ─────────────────────────────────

/**
 * Fields the admin's "New review" modal collects. Slug picks the product; the
 * rest is the same shape as a customer submission except the review is
 * created `approved` (no moderation self-loop) and gets the verified badge
 * (`verifiedOverride = true`) — an ops-authored review is treated as
 * authoritative, per the console's "always verified" toggle in the modal.
 */
export interface CreateReviewInput {
  productSlug: string
  name: string
  place?: string | null
  rating: number      // 1–5, validated at the route boundary
  title?: string | null
  body: string
  /** Optional attachments — same shape and same S3 prefix as customer
   *  reviews. Empty / omitted means no media. */
  media?: { url: string; kind: 'image' | 'video' }[]
}

export class ProductNotFoundError extends Error {
  constructor(slug: string) {
    super(`Product not found for slug ${slug}`)
    this.name = 'ProductNotFoundError'
  }
}

/**
 * Admin-authored review. Straight to `approved` — the moderator IS the author,
 * so making them re-approve their own row would be busywork. `verifiedOverride`
 * is set explicitly so the storefront's "verified buyer" badge appears without
 * the userId+purchase heuristic in `getProduct` (which would otherwise render
 * an ops-authored review as unverified, since there is no linked User row).
 * Bumps the product's aggregate rating + count in the same call.
 */
export async function createReview(brand: Brand, input: CreateReviewInput): Promise<ReviewRow> {
  const prisma = dbFor(brand)
  const product = await prisma.product.findUnique({
    where: { slug: input.productSlug },
    select: { id: true },
  })
  if (!product) throw new ProductNotFoundError(input.productSlug)

  const created = await prisma.review.create({
    data: {
      productId: product.id,
      name: input.name,
      place: input.place ?? null,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
      status: 'approved',
      verifiedOverride: true,
      media: input.media && input.media.length > 0 ? (input.media as unknown as object[]) : undefined,
    },
    include: { product: { select: { name: true } } },
  })
  await refreshProductRating(brand, created.productId)
  return toRow(created)
}


/**
 * Set a review's moderation status. Returns the reconciled row so the queue can
 * update in place, or null when the id no longer exists (P2025 → 404 upstream).
 */
/**
 * Recompute `Product.rating` and `Product.reviewCount` from the APPROVED rows.
 *
 * Both are denormalised counters the storefront prints beside a product - a star
 * line and an "(N)" - and nothing recomputed them when a moderator changed what
 * was approved. So hiding a one-star review left the average it dragged down in
 * place, and approving a five-star one did not move it: the console's queue
 * decided which reviews a shopper could READ while the number above them stayed
 * at whatever a seed last wrote.
 *
 * Called after every status change and every delete. It is one aggregate over an
 * indexed column, on an action a human takes one row at a time.
 */
async function refreshProductRating(brand: Brand, productId: string): Promise<void> {
  const prisma = dbFor(brand)
  const stats = await prisma.review.aggregate({
    where: { productId, status: 'approved' },
    _avg: { rating: true },
    _count: true,
  })
  await prisma.product.update({
    where: { id: productId },
    data: {
      // One decimal, which is what "4.8" on the card is. `_avg` is null when the
      // last approved review has just been hidden - that is a real 0, not a gap.
      rating: Math.round((stats._avg.rating ?? 0) * 10) / 10,
      reviewCount: stats._count,
    },
  })
}

export async function setReviewStatus(brand: Brand, 
  id: string,
  status: ModerationStatus,
): Promise<ReviewRow | null> {
  const prisma = dbFor(brand)
  try {
    const r = await prisma.review.update({
      where: { id },
      data: { status },
      include: { product: { select: { name: true } } },
    })
    await refreshProductRating(brand, r.productId)
    return toRow(r)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
    throw err
  }
}

/** Hard-delete a review. Returns null when the row is already gone (P2025). */
export async function deleteReview(brand: Brand, id: string): Promise<{ id: string } | null> {
  const prisma = dbFor(brand)
  try {
    // `delete` returns the row, which is the only way to learn which product to
    // roll up AFTER the row is gone.
    const deleted = await prisma.review.delete({ where: { id } })
    await refreshProductRating(brand, deleted.productId)
    return { id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
    throw err
  }
}

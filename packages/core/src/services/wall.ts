import 'server-only'
import { Prisma } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Community Wall service — the seam between the database and the storefront
 * Periods Wall (src/screens/PeriodsWall.tsx), which previously lived entirely
 * in localStorage.
 *
 * Two design notes that shape everything below:
 *
 *  1. Moderation. Every submission lands as `pending`; only `approved` posts are
 *     ever read back onto the wall. New posts therefore do NOT appear until an
 *     admin approves them (the compose form shows an "awaiting review" state).
 *
 *  2. Free-text "product". The compose chips ("First period", "Another brand",
 *     "Femi9 330mm") are labels that don't map to catalog Products, and WallPost
 *     has only a `productId` FK — no free-text product column. So the chosen
 *     label is preserved as the first entry of `tags`, and the display `product`
 *     reads from the linked Product name when present, else that label. The
 *     `productId` FK is still honoured when a real id is supplied (a future
 *     authenticated flow), but guests never send one.
 */

export interface WallPostDTO {
  id: string
  name: string // real name, or "Anonymous"
  handle: string // gentle alias (shown as the display name when anonymous)
  product: string // "what did you use?" label; "" when none
  rating: number // 0 = no rating, else 1–5
  body: string
  tags: string[]
  likeCount: number
  createdAt: string // ISO 8601 — Dates aren't JSON-serialisable to the client.
}

export interface CreatePostInput {
  alias?: string
  isAnonymous: boolean
  productId?: string
  product?: string // free-text "what did you use?" label
  rating?: number
  body: string
  tags?: string[]
}

// ─────────────────────────── alias helpers ───────────────────────────────
// Gentle anonymous aliases (moved server-side so anonymous handles are minted
// durably at write time, not regenerated on every client render).

const ALIAS_A = ['quiet', 'gentle', 'soft', 'calm', 'brave', 'kind', 'warm', 'still', 'moonlit', 'sunny']
const ALIAS_B = ['lotus', 'jasmine', 'river', 'dawn', 'breeze', 'koel', 'peony', 'marigold', 'tulsi', 'willow']
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]
const randomAlias = () => `${pick(ALIAS_A)}_${pick(ALIAS_B)}`
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 18) || 'friend'

// The exact query payload, so `toDTO` stays type-checked against the include.
type WallPostWithProduct = Prisma.WallPostGetPayload<{
  include: { product: { select: { name: true } } }
}>

/** Map a DB row → the shape PeriodsWall renders. */
function toDTO(row: WallPostWithProduct): WallPostDTO {
  return {
    id: row.id,
    name: row.isAnonymous ? 'Anonymous' : row.alias || 'Friend',
    // Anonymous rows already store a gentle alias; named rows get a slug handle.
    handle: row.isAnonymous ? row.alias || 'friend' : slugify(row.alias || 'friend'),
    // Prefer a linked catalog product; fall back to the preserved label tag.
    product: row.product?.name ?? row.tags[0] ?? '',
    rating: row.rating ?? 0,
    body: row.body,
    tags: row.tags,
    likeCount: row.likeCount,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─────────────────────────────── Reads ────────────────────────────────────

/** Approved posts only, newest first — the public wall feed. */
export async function listApprovedPosts(brand: Brand): Promise<WallPostDTO[]> {
  const prisma = dbFor(brand)
  const rows = await prisma.wallPost.findMany({
    where: { status: 'approved' },
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { name: true } } },
  })
  return rows.map(toDTO)
}

// ─────────────────────────────── Writes ───────────────────────────────────

/**
 * Create a submission. Always `pending` — nothing a guest posts is public until
 * a moderator approves it. Returns the stored (pending) row as a DTO so the
 * route can acknowledge without a second read.
 */
export async function createPost(brand: Brand, input: CreatePostInput): Promise<WallPostDTO> {
  const prisma = dbFor(brand)
  // Only honour a productId that actually resolves; guests send free-text
  // labels, not ids, so this is null for storefront posts.
  let productId: string | null = null
  if (input.productId) {
    const found = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true },
    })
    productId = found?.id ?? null
  }

  // Preserve the free-text "what did you use?" label as the first tag (the
  // schema has no free-text product column) — but only when it isn't already a
  // resolved catalog product.
  const tags = [...(input.tags ?? [])]
  const label = input.product?.trim()
  if (label && !productId && !tags.includes(label)) tags.unshift(label)

  // Anonymous → mint a gentle alias; named → store the name (slugged on read).
  const alias = input.isAnonymous
    ? input.alias?.trim() || randomAlias()
    : input.alias?.trim() || 'Friend'

  const row = await prisma.wallPost.create({
    data: {
      alias,
      isAnonymous: input.isAnonymous,
      productId,
      rating: input.rating ?? null,
      body: input.body.trim(),
      tags,
      status: 'pending', // moderated: not visible until approved
    },
    include: { product: { select: { name: true } } },
  })
  return toDTO(row)
}

/**
 * Register a like. WallLike requires a real `userId`, which guests don't have,
 * so we can't durably dedupe per guest — the simplest acceptable behaviour is to
 * increment the counter. Only `approved` posts are likeable (you can't like a
 * pending/hidden one). Returns the new count, or null when the post is missing
 * or not approved (→ 404 upstream). `guestToken` is accepted for signature/
 * forward-compat but isn't durable enough to dedupe against.
 */
export async function likePost(brand: Brand, postId: string, userId: string): Promise<{ likeCount: number; liked: boolean } | null> {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    const post = await tx.wallPost.findUnique({ where: { id: postId }, select: { status: true } })
    if (!post || post.status !== 'approved') return null
    const existing = await tx.wallLike.findUnique({ where: { postId_userId: { postId, userId } } })
    if (existing) {
      await tx.wallLike.delete({ where: { id: existing.id } })
      const updated = await tx.wallPost.update({
        where: { id: postId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      })
      return { likeCount: Math.max(0, updated.likeCount), liked: false }
    }
    await tx.wallLike.create({ data: { postId, userId } })
    const updated = await tx.wallPost.update({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    })
    return { likeCount: updated.likeCount, liked: true }
  })
}

import 'server-only'
import { Prisma } from '@prisma/client'
import type { ModerationStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Admin community-wall service — the moderation-side counterpart to the
 * storefront read path (which only ever surfaces `approved` posts). Moderators
 * see EVERY row regardless of status so `pending` submissions can be triaged and
 * abusive ones hidden or removed.
 *
 * Rows are shaped for the client here (product name flattened in, `createdAt`
 * serialised to an ISO string) so the moderation queue — a client component —
 * can consume them straight from JSON without touching this `server-only` module.
 */

export type WallRow = {
  id: string
  displayName: string // "Anonymous" or the poster's alias/name
  isAnonymous: boolean
  product: string | null // linked catalog product name, else the free-text label
  rating: number | null
  body: string
  tags: string[]
  likeCount: number
  status: ModerationStatus
  createdAt: string // ISO 8601 — Dates aren't JSON-serialisable to the client.
}

// The exact query payload, so `toRow` stays type-checked against the include.
type WallPostWithProduct = Prisma.WallPostGetPayload<{
  include: { product: { select: { name: true } } }
}>

function toRow(r: WallPostWithProduct): WallRow {
  return {
    id: r.id,
    displayName: r.isAnonymous ? 'Anonymous' : r.alias || 'Friend',
    isAnonymous: r.isAnonymous,
    // Mirror the storefront: prefer a linked product, else the preserved label tag.
    product: r.product?.name ?? r.tags[0] ?? null,
    rating: r.rating,
    body: r.body,
    tags: r.tags,
    likeCount: r.likeCount,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** All wall posts (optionally filtered by status), newest first. */
export async function listWall(brand: Brand, {
  status,
}: { status?: ModerationStatus } = {}): Promise<WallRow[]> {
  const prisma = dbFor(brand)
  const rows = await prisma.wallPost.findMany({
    // Omit the filter entirely when no status is given so the query planner sees
    // a plain "all rows" read rather than `status IN (…)`.
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { name: true } } },
  })
  return rows.map(toRow)
}

// ─────────────────────────────── Writes ─────────────────────────────────

/**
 * Set a post's moderation status. Returns the reconciled row so the queue can
 * update in place, or null when the id no longer exists (P2025 → 404 upstream).
 */
export async function setStatus(brand: Brand, 
  id: string,
  status: ModerationStatus,
): Promise<WallRow | null> {
  const prisma = dbFor(brand)
  try {
    const r = await prisma.wallPost.update({
      where: { id },
      data: { status },
      include: { product: { select: { name: true } } },
    })
    return toRow(r)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
    throw err
  }
}

/** Hard-delete a post. Returns null when the row is already gone (P2025). */
export async function remove(brand: Brand, id: string): Promise<{ id: string } | null> {
  const prisma = dbFor(brand)
  try {
    await prisma.wallPost.delete({ where: { id } })
    return { id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
    throw err
  }
}

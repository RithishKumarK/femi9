import 'server-only'
import { dbFor, type Brand, type ProductType as DbProductType } from '@femi9/db'
import { featuredSlots } from '../brands'
import { applyZonePrice, resolveAmbientZone, type ResolvedZone } from './pricing'
import type { Product, ProductType } from '../types/catalog'
import type { ProductExtra } from '../types/catalog'

/**
 * Product service — the single seam between the database and the UI.
 *
 * DB rows are mapped back onto the existing `Product` / `ProductExtra` shapes so
 * the storefront components can consume live data with no structural change.
 * `id` maps to the product `slug` (which we kept equal to the original id), so
 * existing /product/:id links keep working.
 *
 * Every price leaving this service is a ZONE price — the zone's custom price for
 * that product/variant when the admin set one, else its percentage discount. The
 * catalogue used to print `variant.price` raw while checkout charged the regional
 * price, so a shopper in a discounted state was quoted one number on the card and
 * a different one at the payment sheet.
 */

export interface Variant {
  id: string
  kind: 'pack' | 'size'
  label: string
  packCount: number | null
  size: string | null
  /** What the cart charges. */
  price: number
  /**
   * What it costs without the discount — the number struck through.
   *
   * Always present and never below `price`: a row with no stored mrp (written
   * before the column existed) reports its price, so `mrp === price` means
   * "no discount" and there is no third state for a caller to get wrong.
   *
   * The DISCOUNT PERCENTAGE is deliberately not carried. A badge computed from
   * these two numbers is a badge that cannot contradict them; one carried
   * separately is a third number that can, which is exactly how the storefront
   * came to advertise 10% off while the gateway charged full price.
   */
  mrp: number
  stock: number
}

export interface ProductWithVariants extends Product {
  variants: Variant[]
}

export interface ProductReview {
  id: string
  name: string
  place: string | null
  rating: number
  /** Optional one-line headline. Null on every row written before it existed. */
  title: string | null
  body: string
  /** Helpful / not-helpful tallies shown under each card. */
  helpfulUp: number
  helpfulDown: number
  /** "14/10/2025" — preformatted. Every card used to print a hardcoded 'Jun 2026'
   *  because the DTO carried no date at all. */
  date: string
  /** True only when this reviewer actually bought this product. The badge used
   *  to read "Verified Buyer" unconditionally on every card. */
  verified: boolean
  /** Photos + short clips the shopper attached. Empty array when none — the
   *  read layer normalises Review.media (null | []) to a consistent shape so
   *  the storefront never has to null-check. */
  media: { url: string; kind: 'image' | 'video' }[]
}

/**
 * A product as the DATABASE has it, before any brand's view model is applied.
 *
 * `getProducts` below maps rows onto Femi9's `Product` shape — `meta`, `flow`,
 * `packs` — which is exactly right for that storefront and wrong for Lumi9,
 * whose UI is organised by nappy size with pack tiers underneath. Rather than
 * teach one mapper two vocabularies, this returns the rows and lets each
 * storefront shape them.
 *
 * It carries `specs`, which the Femi9 mapper drops, and real variant ids, which
 * a cart needs.
 */
export interface CatalogEntry {
  id: string
  slug: string
  name: string
  /** The DATABASE enum, not a storefront's view model — this row is unmapped. */
  type: DbProductType
  basePrice: number
  meta: string
  flow: string
  /**
   * The weight band this size fits, in kg — Lumi9's diapers only.
   *
   * `specs` already carries "7-12 kg" for a size chip to print, and Lumi9's
   * size-up projector carried its own numeric copy of the same bands, with a
   * comment conceding the two "must be kept in step" by hand. They were not:
   * renaming a range in the console moved what a parent READ and never what the
   * projector CALCULATED. Null on a Femi9 pad, which has no such band.
   */
  minWeightKg: number | null
  maxWeightKg: number | null
  /**
   * The product's own rating and review tally, as maintained from moderated
   * `Review` rows.
   *
   * Carried on the catalogue because Lumi9's product page printed a hardcoded
   * "4.9 · 482 verified reviews" on all five sizes — a fabricated number beside
   * a real, moderated review rail, on a page that also sells the product. These
   * are the honest values; `reviewCount: 0` means say nothing.
   */
  rating: number
  reviewCount: number
  description: string
  longDescription: string | null
  images: { url: string; alt: string | null }[]
  specs: { key: string; value: string }[]
  /**
   * Key Benefits, in the console's order.
   *
   * Carried here and not only on `getProduct` because a storefront that reads
   * the catalogue in one query should not have to fetch a product again to find
   * out what its own product page says about it - which is what forced Lumi9's
   * PDP copy to live in a module while the console edited rows nothing read.
   */
  features: { title: string; body: string }[]
  variants: Variant[]
}

/**
 * Every active product for a brand, unmapped. Ordered oldest-first, which is the
 * order the seeds write and therefore the order a size run reads in.
 *
 * **Every price here is a ZONE price**, exactly as `listProducts` returns — the
 * zone's custom price for that product or variant when the console set one, else
 * its percentage discount.
 *
 * It did not used to be, and that was a live defect on the brand that reads this
 * loader for its whole storefront. `cart.ts` and `checkout.ts` have always priced
 * with `applyZonePrice`, so a shopper in a discounted state was quoted the base
 * price on the card and on the product page, and charged the regional one at the
 * basket — the console's own regional pricing, invisible everywhere until the
 * moment it changed the total. It is the same bug the mapper below this one
 * carries a comment about; only this entry point was missed, because when it was
 * written no storefront read it.
 */
export async function getCatalog(brand: Brand): Promise<CatalogEntry[]> {
  const [rows, zone] = await Promise.all([loadRows(brand), resolveAmbientZone(brand)])
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    // Keyed by WHAT it prices, so a zone's custom price for this exact product
    // is found; without the key it falls back to the zone's percentage.
    basePrice: applyZonePrice(row.basePrice, zone, { productId: row.id }),
    meta: row.meta,
    flow: row.flow,
    minWeightKg: row.minWeightKg,
    maxWeightKg: row.maxWeightKg,
    rating: row.rating,
    reviewCount: row.reviewCount,
    description: row.description,
    longDescription: row.longDescription,
    images: row.images.map((i) => ({ url: i.url, alt: i.alt })),
    specs: row.specs.map((sp) => ({ key: sp.key, value: sp.value })),
    features: row.features.map((f) => ({ title: f.title, body: f.body })),
    variants: row.variants.map((v) => ({
      id: v.id,
      kind: v.kind,
      label: v.label,
      packCount: v.packCount,
      size: v.size,
      price: applyZonePrice(v.price, zone, { variantId: v.id }),
      // Through the SAME zone resolution as the price. A zone that overrides a
      // variant's price outright resolves both to that number, so mrp === price
      // and no discount is advertised — which is right: an explicit zone price
      // is a price, not a sale.
      mrp: applyZonePrice(v.mrp ?? v.price, zone, { variantId: v.id }),
      stock: v.stock,
    })),
  }))
}

/**
 * Approved reviews, either for one product or across the whole brand.
 *
 * `getProduct` already returns a product's reviews, but two surfaces need them
 * WITHOUT loading a product: a storefront's testimonial rail, which is
 * brand-wide, and a product page that has already resolved its row through the
 * catalogue loader and should not fetch it twice.
 *
 * Only `approved` rows, always — the console's moderation queue is the gate
 * between somebody typing a review and a shopper reading it, and a surface that
 * reads `pending` makes that queue decorative.
 *
 * ⚠️ `verified` is NOT resolved here. Proving a reviewer bought the product is a
 * second query per product (see `getProduct`), and a brand-wide rail would turn
 * that into one query per row. The flag is false on every row this returns, and
 * a caller that renders a "verified buyer" badge must use `getProduct` instead
 * of promoting an unproven claim to a visible one.
 */
export async function listReviews(
  brand: Brand,
  options: { productSlug?: string; limit?: number } = {},
): Promise<ProductReview[]> {
  const prisma = dbFor(brand)
  const rows = await prisma.review.findMany({
    where: {
      status: 'approved',
      // Reviews of a retired product are not brand testimony any more.
      product: { status: 'active', ...(options.productSlug ? { slug: options.productSlug } : {}) },
    },
    orderBy: { createdAt: 'desc' },
    ...(options.limit ? { take: options.limit } : {}),
  })

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    place: r.place,
    rating: r.rating,
    title: r.title,
    body: r.body,
    helpfulUp: r.helpfulUp,
    helpfulDown: r.helpfulDown,
    date: r.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    verified: false,
    media: normalizeReviewMedia(r.media),
  }))
}

/**
 * `Review.media` is a Prisma `Json?` column so what we get back from Postgres
 * is unknown-shape at compile time. Narrow it: null / not-an-array → `[]`, and
 * every entry that isn't a `{ url: string, kind: 'image'|'video' }` shape is
 * dropped. Never trust what a JSON column held, even when this codebase is the
 * only writer.
 */
function normalizeReviewMedia(raw: unknown): { url: string; kind: 'image' | 'video' }[] {
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

export interface FullProduct {
  product: ProductWithVariants
  extra: ProductExtra
  reviews: ProductReview[]
}

type Row = Awaited<ReturnType<typeof loadRows>>[number]

/**
 * Everything a `Product` view model needs, in the order the console publishes.
 * Shared by the two loaders below so a featured card and a catalogue card can
 * never be built from different columns.
 */
const PRODUCT_INCLUDE = {
  variants: { where: { active: true }, orderBy: { price: 'asc' } },
  images: { orderBy: { position: 'asc' } },
  features: { orderBy: { position: 'asc' } },
  specs: { orderBy: { position: 'asc' } },
} as const

function loadRows(brand: Brand) {
  const prisma = dbFor(brand)
  return prisma.product.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
    include: PRODUCT_INCLUDE,
  })
}

/** The flagged rows, oldest-featured first — the rail's order. */
function loadFeaturedRows(brand: Brand, take: number) {
  const prisma = dbFor(brand)
  return prisma.product.findMany({
    where: { status: 'active', featured: true },
    // `featuredAt` is the slot, so featuring a sixth product never reshuffles
    // the five already there. `createdAt` only breaks a tie between two rows
    // flagged in the same millisecond.
    orderBy: [{ featuredAt: 'asc' }, { createdAt: 'asc' }],
    take,
    include: PRODUCT_INCLUDE,
  })
}

/** Map a DB row → the `Product` shape the cards/grid expect. */
function toProduct(row: Row, zone: ResolvedZone | null): ProductWithVariants {
  // Each price is keyed by WHAT it prices, so a zone's custom price for this
  // product/variant is found; without the key it would fall back to the zone's
  // percentage and the card would contradict the cart.
  const zonedVariant = (price: number, variantId: string) =>
    applyZonePrice(price, zone, { variantId })

  const packs = row.variants
    .filter((v) => v.kind === 'pack')
    .map((v) => ({ count: v.packCount ?? 0, price: zonedVariant(v.price, v.id) }))
  const sizes = row.variants.filter((v) => v.kind === 'size').map((v) => v.size ?? v.label)

  return {
    id: row.slug,
    name: row.name,
    price: applyZonePrice(row.basePrice, zone, { productId: row.id }),
    img: row.images[0]?.url ?? '',
    meta: row.meta,
    flow: row.flow,
    desc: row.description,
    tag: row.tag ?? undefined,
    tagClass: (row.tagClass as 'pink' | undefined) ?? undefined,
    type: row.type as ProductType,
    packs: packs.length ? packs : undefined,
    sizes: sizes.length ? sizes : undefined,
    variants: row.variants.map((v) => ({
      id: v.id,
      kind: v.kind as 'pack' | 'size',
      label: v.label,
      packCount: v.packCount,
      size: v.size,
      price: zonedVariant(v.price, v.id),
      // Same zone resolution as the price — see the note on Variant.mrp.
      mrp: zonedVariant(v.mrp ?? v.price, v.id),
      stock: v.stock,
    })),
  }
}

/** Map a DB row → the `ProductExtra` shape the detail page expects. */
function toExtra(row: Row): ProductExtra {
  return {
    gallery: row.images.map((i) => i.url),
    rating: row.rating,
    reviews: row.reviewCount,
    long: row.longDescription ?? row.description,
    features: row.features.map((f) => ({ title: f.title, body: f.body })),
    specs: row.specs.map((s) => ({ k: s.key, v: s.value })),
  }
}

/** All active products, in the `Product` shape (catalog grid / cards). */
export async function listProducts(brand: Brand): Promise<ProductWithVariants[]> {
  const [rows, zone] = await Promise.all([loadRows(brand), resolveAmbientZone(brand)])
  return rows.map((row) => toProduct(row, zone))
}

/**
 * The landing page's featured rail — the products an admin flagged, in the
 * order they flagged them, capped at the brand's slot count.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The rail was `listProducts(brand).slice(0, 4)` in the Home screen. That is
 * creation order, so the one row of cards most shoppers ever see was decided by
 * which products were typed into the catalogue first, and the only way to change
 * it was to re-create a product. `Product.featured` makes it an editorial choice
 * the console owns — see `setProductFeatured` in services/admin/products.
 *
 * ── The fallback ────────────────────────────────────────────────────────────
 * With NOTHING flagged this returns the first `limit` active products, which is
 * exactly what the slice did. That is deliberate and it is not a placeholder:
 * a brand-new catalogue, a freshly seeded staging database and the live rows on
 * the day this ships all have zero featured products, and a blank rail on the
 * homepage is a worse answer than the old one. The moment an admin features a
 * single product the fallback stops applying and the rail is exactly what they
 * chose — including a rail of one, which the grid lays out for.
 *
 * A brand with no rail (`featuredSlots: 0` — Lumi9) gets an empty array and no
 * query. Its homepage product section is the size run, not a selection.
 */
export async function listFeaturedProducts(
  brand: Brand,
  limit: number = featuredSlots(brand),
): Promise<ProductWithVariants[]> {
  if (limit <= 0) return []

  const [featured, zone] = await Promise.all([
    loadFeaturedRows(brand, limit),
    resolveAmbientZone(brand),
  ])
  if (featured.length > 0) return featured.map((row) => toProduct(row, zone))

  const rows = await loadRows(brand)
  return rows.slice(0, limit).map((row) => toProduct(row, zone))
}

/** One product by slug, with detail extras and moderated reviews. */
export async function getProduct(brand: Brand, slug: string): Promise<FullProduct | null> {
  const prisma = dbFor(brand)
  const row = await prisma.product.findFirst({
      where: { slug, status: 'active' },
      include: {
        variants: { where: { active: true }, orderBy: { price: 'asc' } },
        images: { orderBy: { position: 'asc' } },
        features: { orderBy: { position: 'asc' } },
        specs: { orderBy: { position: 'asc' } },
        reviews: { where: { status: 'approved' }, orderBy: { createdAt: 'desc' } },
      },
    })
  if (!row) return null

  // "Verified buyer" has to mean something: resolve, in one query, which of
  // these reviewers actually has a paid order containing a variant of THIS
  // product. Anonymous reviews (userId null) are never verified.
  const reviewerIds = row.reviews.map((r) => r.userId).filter((id): id is string => Boolean(id))
  const buyerIds = new Set<string>()
  if (reviewerIds.length > 0) {
    const buyers = await prisma.order.findMany({
      where: {
        userId: { in: reviewerIds },
        status: { in: ['paid', 'processing', 'shipped', 'delivered'] },
        items: { some: { variant: { productId: row.id } } },
      },
      select: { userId: true },
      distinct: ['userId'],
    })
    for (const b of buyers) if (b.userId) buyerIds.add(b.userId)
  }

  const reviews: ProductReview[] = row.reviews.map((r) => ({
    id: r.id,
    name: r.name,
    place: r.place,
    rating: r.rating,
    title: r.title,
    body: r.body,
    helpfulUp: r.helpfulUp,
    helpfulDown: r.helpfulDown,
    // Day-precision, dd/mm/yyyy. The card sits beside a helpfulness control, and
    // "was this recent?" is the question a reader asks before trusting a vote
    // count — a month/year stamp cannot answer it.
    date: r.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    // Admin-authored reviews carry `verifiedOverride`; that wins over the
    // userId+purchase heuristic because those reviews have no linked User row
    // and would otherwise always render as unverified.
    verified: r.verifiedOverride ?? Boolean(r.userId && buyerIds.has(r.userId)),
    media: normalizeReviewMedia(r.media),
  }))

  return {
      product: toProduct(row, await resolveAmbientZone(brand)),
      extra: toExtra(row),
      reviews,
  }
}

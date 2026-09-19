import 'server-only'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { featuredSlots } from '../../brands'
import { isManagedImageUrl, MANAGED_IMAGE_URL_MESSAGE } from '../../image-url'

/**
 * Admin product service — the write-side counterpart to src/lib/services/products.ts
 * (which is read-only + storefront-shaped and only ever sees `active` rows).
 *
 * This module powers the reusable add/edit-product template: it must work for
 * ANY future product, so nothing here is hardcoded to the current catalogue.
 * A product is a set of scalar fields + an ordered image list + a dynamic list
 * of variants (packs for pads, sizes for panties). On update we DIFF variants by
 * id so the editor can freely add/remove/reorder rows in one round-trip.
 */

// ─────────────────────────── Validation (zod) ───────────────────────────
// z.coerce on numbers so a JSON payload carrying "225" (from an <input>) is
// accepted as well as 225 — the form sends strings for numeric fields.

const VariantInput = z.object({
  // Present => update an existing variant; absent => create a new one.
  id: z.string().optional(),
  kind: z.enum(['pack', 'size']),
  label: z.string().trim().min(1, 'Label is required'),
  // packCount belongs to packs, size to sizes; the other is null (enforced below).
  packCount: z.coerce.number().int().min(0).nullable().optional(),
  size: z.string().trim().min(1).nullable().optional(),

  // ── What the admin types, and what the server works out ──────────────────
  // The console asks for the MRP and, optionally, a discount. The CHARGED price
  // is computed from them by `chargedPrice` below and written in the same
  // transaction, so the strikethrough, the badge and the cart line are three
  // renderings of one number rather than three numbers that have to agree.
  //
  // `price` is still ACCEPTED here, and ignored when an mrp is present. Older
  // callers (and the seed) post a bare price; treating that as "mrp with no
  // discount" keeps them working and makes the row consistent on the way in.
  mrp: z.coerce.number().int().min(0, 'MRP must be ≥ 0').optional(),
  // Whole percent. Capped at 90 rather than 100: a free order is not a decision
  // anybody makes by typing into a price field, and a 100% line breaks the
  // gateway's minimum charge anyway.
  discountPct: z.coerce
    .number()
    .int()
    .min(0, 'Discount must be ≥ 0%')
    .max(90, 'Discount is capped at 90% — a free order is not a price edit')
    .default(0),
  // OPTIONAL, and only a fallback. The console omits `price` on purpose and
  // lets the server derive it; declaring it required meant z.coerce ran
  // Number(undefined) on every save from the product form and rejected it
  // with "expected number, received NaN" — discount or no discount.
  price: z.coerce.number().int().min(0, 'Price must be ≥ 0').optional(),
  // Empty SKU is normalised to null so many variants can share "no SKU" without
  // tripping the unique index (Postgres allows multiple NULLs, not multiple '').
  sku: z.string().trim().optional().nullable(),
  stock: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
})
  // Exactly one of them is always present in practice — the console sends
  // `mrp`, the catalog import sends a bare `price` — but neither is
  // individually required, so the pair has to be checked here rather than
  // silently pricing the row at zero.
  .refine((v) => v.mrp !== undefined || v.price !== undefined, {
    message: 'Either an MRP or a price is required',
    path: ['mrp'],
  })

/** A Key Benefits entry. The PDP reads the first six and mirrors them three per
 *  side, so order is meaningful — position follows array index. */
const FeatureInput = z.object({
  title: z.string().trim().min(1, 'Feature title is required'),
  body: z.string().trim().default(''),
})

/** One row of the PDP specs table. */
const SpecInput = z.object({
  key: z.string().trim().min(1, 'Spec name is required'),
  value: z.string().trim().default(''),
})

export const ProductInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  // Blank slug => auto-derived from the name and made unique in the service.
  slug: z.string().trim().optional().default(''),
  // The union of what ANY brand sells. Which of them a given brand may use is
  // not a validation concern — see allowsProductType in @femi9/core/brands,
  // called by the routes that accept this input.
  type: z.enum(['pad', 'panty', 'diaper']),
  basePrice: z.coerce.number().int().min(0, 'Base price must be ≥ 0'),
  // meta/flow/description are NOT NULL in the schema; default '' keeps the form
  // forgiving while still writing a valid row.
  meta: z.string().trim().default(''),
  flow: z.string().trim().default(''),
  description: z.string().trim().default(''),
  longDescription: z.string().trim().optional().nullable(),
  tag: z.string().trim().optional().nullable(),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
  /**
   * Only images this platform hosts — see @femi9/core/image-url. The form is an
   * upload button now, but the form is UI; this is what a crafted POST meets.
   * Without it the column would still accept `https://someone-else.example/x.png`
   * (hotlinked, and leaking our shoppers' referrers to a third party) or a
   * `data:`/`javascript:` URL that becomes stored XSS the moment a template puts
   * it somewhere that executes.
   */
  images: z
    .array(z.string().trim().min(1).refine(isManagedImageUrl, MANAGED_IMAGE_URL_MESSAGE))
    .default([]),
  variants: z.array(VariantInput).default([]),
  /**
   * Key Benefits and the specs table. Both were previously READ into the editor
   * (see getAdminProduct) with no way to write them back, so the PDP's benefit
   * panel and spec table could only ever be populated by a seed fixture — a
   * product created through the console got neither.
   *
   * `.optional()` with NO default, unlike images/variants above, and the
   * distinction carries meaning in updateProduct:
   *   absent  → leave the existing rows alone
   *   []      → clear them
   * A default of [] here would make every PATCH from a client that doesn't send
   * these fields silently wipe whatever was already published.
   */
  features: z.array(FeatureInput).optional(),
  specs: z.array(SpecInput).optional(),
  /**
   * On the landing page's featured rail.
   *
   * `.optional()` with NO default, for the same reason `features`/`specs` are:
   *   absent → leave the flag as it is
   *   false  → unfeature
   * A `.default(false)` here would make every PATCH from a client that does not
   * send the field silently pull the product off the homepage — and nothing
   * would error, so the first anyone would know is the rail going short.
   *
   * The "at most N" cap is not expressible here (it depends on the other rows
   * and on the brand); see `assertFeaturedCapacity`.
   */
  featured: z.boolean().optional(),
})

export type ProductInput = z.infer<typeof ProductInputSchema>
type VariantInputT = z.infer<typeof VariantInput>

// ────────────────────────── Featured rail rules ─────────────────────────

/**
 * A featured-rail rule the caller broke. Routes catch this and return a 400
 * carrying `.message`, which is written for the person looking at the console —
 * "Only 5 products can be featured" is an answer; "500" is not.
 *
 * A distinct class rather than a `{ ok: false }` return because the checks
 * happen INSIDE the write transaction (see below), where the only way to abort
 * without committing half a product is to throw.
 */
export class FeaturedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeaturedError'
  }
}

/** The brand's slots are full. Carries the limit so a form can say the number. */
export class FeaturedLimitError extends FeaturedError {
  readonly limit: number
  constructor(limit: number) {
    super(
      limit === 0
        ? 'This brand has no featured rail on its landing page.'
        : `Only ${limit} products can be featured at a time. Unfeature one first.`,
    )
    this.name = 'FeaturedLimitError'
    this.limit = limit
  }
}

/**
 * Refuse a sixth featured product.
 *
 * ⚠️ Always call this with `tx`, the transaction handle, never the base client.
 * Counting outside the transaction that then writes the flag is a check-then-act
 * race: two admins featuring at the same moment both read 4, both pass, and the
 * rail renders six cards into a five-column grid. Inside the transaction the
 * second one sees the first's row.
 *
 * `excludeId` is the product being written — a product that is ALREADY featured
 * and is merely being re-saved must not count itself out of its own slot.
 */
async function assertFeaturedCapacity(
  tx: Prisma.TransactionClient,
  brand: Brand,
  excludeId?: string,
) {
  const limit = featuredSlots(brand)
  if (limit <= 0) throw new FeaturedLimitError(0)
  const count = await tx.product.count({
    where: { featured: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  })
  if (count >= limit) throw new FeaturedLimitError(limit)
}

/**
 * Only a published product goes on the homepage.
 *
 * A draft or archived one would render a card linking to a 404 (the storefront
 * filters on `status: 'active'`, so the PDP is gone while the flag survives) and
 * would hold a slot no screen could show was taken.
 */
function assertFeaturable(status: 'active' | 'draft' | 'archived') {
  if (status !== 'active') {
    throw new FeaturedError('Only an active product can be featured on the landing page.')
  }
}

// ───────────────────────────── Slug helpers ─────────────────────────────

function slugify(source: string): string {
  return source
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolve a unique slug. Derives from `source`, then appends -2, -3, … until it
 * finds a free one. `excludeId` lets an edit keep its own slug. Racy under heavy
 * concurrency, but the DB unique index is the real backstop (P2002 → 400).
 */
async function resolveSlug(brand: Brand, source: string, excludeId?: string): Promise<string> {
  const prisma = dbFor(brand)
  const base = slugify(source) || 'product'
  let candidate = base
  let n = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.product.findFirst({
      where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return candidate
    candidate = `${base}-${n++}`
  }
}

/**
 * THE ONE PLACE A DISCOUNT BECOMES A PRICE.
 *
 * `mrp` is what the pack is worth and `discountPct` is what is coming off it;
 * this is the only expression that turns the pair into the number a cart line
 * is priced from. Rounded to whole rupees because every price in this schema is
 * an integer — there are no paise anywhere, and a half-rupee line total would
 * disagree with the gateway.
 *
 * Exported so the console can show the admin the result BEFORE they save, from
 * this function rather than from a copy of the arithmetic in the form. A form
 * that computes its own preview is how the storefront ended up advertising a
 * 10% discount no server had ever applied.
 */
export function chargedPrice(mrp: number, discountPct: number): number {
  if (!Number.isFinite(mrp) || mrp <= 0) return 0
  const pct = Math.min(90, Math.max(0, Math.round(discountPct)))
  return Math.round(mrp * (1 - pct / 100))
}

/**
 * The MRP and discount a variant input actually carries.
 *
 * An input with no `mrp` is a caller from before this field existed — the seed,
 * an older client, a script. Its `price` IS the undiscounted price, so it reads
 * as an MRP with no discount, and the row it writes is consistent rather than
 * half-populated.
 */
function pricingOf(v: VariantInputT): { mrp: number; discountPct: number; price: number } {
  const mrp = v.mrp ?? v.price ?? 0
  const discountPct = v.mrp === undefined ? 0 : v.discountPct
  return { mrp, discountPct, price: chargedPrice(mrp, discountPct) }
}

/** Strip a variant to the DB columns, coercing kind-specific fields + SKU. */
function cleanVariant(v: VariantInputT) {
  const { mrp, discountPct, price } = pricingOf(v)
  return {
    kind: v.kind,
    label: v.label,
    // Keep only the field that belongs to this kind; null out the other so a
    // row switched pack↔size can't leave a stale value behind.
    packCount: v.kind === 'pack' ? v.packCount ?? null : null,
    size: v.kind === 'size' ? v.size ?? null : null,
    // NEVER v.price. The client's number is a stale preview at best and a
    // contradiction at worst; the server recomputes from mrp + discountPct.
    price,
    mrp,
    discountPct,
    sku: v.sku && v.sku.length > 0 ? v.sku : null,
    stock: v.stock,
    active: v.active,
  }
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** All products (every status) with image thumb, variant count + total stock. */
export async function listAdminProducts(brand: Brand) {
  const prisma = dbFor(brand)
  try {
    const rows = await prisma.product.findMany({
      // Featured first, in rail order, then newest. The five that lead the
      // landing page are a SET an admin arranges, and they are unreadable as one
      // when they are scattered through a catalogue sorted by creation date.
      orderBy: [{ featured: 'desc' }, { featuredAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
        // Pull just stock to sum in-app; the catalogue is small so this is cheap
        // and avoids a second aggregate round-trip per product.
        variants: { select: { stock: true } },
        _count: { select: { variants: true, images: true } },
      },
    })

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      type: r.type,
      basePrice: r.basePrice,
      status: r.status,
      featured: r.featured,
      featuredAt: r.featuredAt,
      thumb: r.images[0]?.url ?? null,
      variantCount: r._count.variants,
      imageCount: r._count.images,
      totalStock: r.variants.reduce((sum, v) => sum + v.stock, 0),
    }))
  } catch {
    return []
  }
}

/**
 * How many slots the brand's rail has, and how many are taken.
 *
 * The console reads this to print "3 of 5 featured" and to disable the control
 * once it is full. It is a HINT, not the enforcement — the count it returns is
 * stale the moment another admin saves. `assertFeaturedCapacity` inside the
 * write transaction is what actually holds the line.
 *
 * `excludeId` leaves one product out of the tally, so the edit form can ask
 * "would there be room for THIS one" without counting the slot it already holds.
 */
export async function getFeaturedCapacity(brand: Brand, excludeId?: string) {
  const limit = featuredSlots(brand)
  if (limit <= 0) return { limit: 0, used: 0, remaining: 0 }
  const prisma = dbFor(brand)
  const used = await prisma.product
    .count({ where: { featured: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) } })
    .catch(() => 0)
  return { limit, used, remaining: Math.max(0, limit - used) }
}

/** One product, fully loaded for the editor (variants/images/features/specs). */
export async function getAdminProduct(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  return prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { price: 'asc' } },
      images: { orderBy: { position: 'asc' } },
      features: { orderBy: { position: 'asc' } },
      specs: { orderBy: { position: 'asc' } },
    },
  })
}

// ─────────────────────────────── Writes ─────────────────────────────────

export async function createProduct(brand: Brand, input: ProductInput) {
  const prisma = dbFor(brand)
  const slug = await resolveSlug(brand, input.slug || input.name)
  const featured = input.featured === true
  if (featured) assertFeaturable(input.status)

  // A transaction only because of the featured cap: the count and the INSERT
  // that consumes a slot have to be one atomic step, or two admins can both
  // take the last one.
  return prisma.$transaction(async (tx) => {
    if (featured) await assertFeaturedCapacity(tx, brand)

    return tx.product.create({
      data: {
        name: input.name,
        slug,
        type: input.type,
        basePrice: input.basePrice,
        meta: input.meta,
        flow: input.flow,
        description: input.description,
        longDescription: input.longDescription || null,
        tag: input.tag || null,
        status: input.status,
        featured,
        // NULL exactly when not featured — the storefront orders on this.
        featuredAt: featured ? new Date() : null,
        images: { create: input.images.map((url, i) => ({ url, position: i })) },
        variants: { create: input.variants.map(cleanVariant) },
        features: {
          create: (input.features ?? []).map((f, i) => ({ title: f.title, body: f.body, position: i })),
        },
        specs: {
          create: (input.specs ?? []).map((s, i) => ({ key: s.key, value: s.value, position: i })),
        },
      },
      select: { id: true },
    })
  })
}

/**
 * Update a product and reconcile its children. Variants are diffed by id:
 *  - row with an id we still have  → update in place
 *  - row without an id (or unknown) → create
 *  - existing id not in the payload → delete
 * Images are simply replaced (they're a plain ordered URL list). All in one
 * transaction so a partial failure never leaves half-applied edits.
 */
/**
 * Keep `basePrice` and the leading pack's price as ONE number.
 *
 * ── Why there are two prices at all ─────────────────────────────────────────
 * The schema serves both brands. Femi9 sells period panties, whose variants are
 * SIZES that all cost the same (the seed writes `price: source.price` for every
 * one), so there `basePrice` is the real price and the variants only pick a fit.
 * Lumi9 sells one product in pack tiers, each with its own price, and its seed
 * simply copies the default tier's price into `basePrice`.
 *
 * So on a pack-tiered product `basePrice` is a DUPLICATE of one tier's price —
 * and a duplicate that nothing charges. Editing "Base price (₹)" in the console
 * saved a column no storefront surface renders and no cart line is priced from:
 * the admin changed a price, the console's own products list agreed with them,
 * and the shop did not move. Nothing errored, which is the worst version of it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * ON A PACK-TIERED PRODUCT, `basePrice` IS A MIRROR. It always becomes the
 * CHARGED price of the tier the storefront leads with, and the console shows it
 * read-only. There is nothing to edit there and nothing to keep in step by hand.
 *
 * It used to be two-way — a base-price edit repriced the leading pack — and that
 * was the right rule while the pack price was a number an admin typed. It stops
 * being right now the price is DERIVED from `mrp` and `discountPct`: "charge
 * ₹225 for this tier" has no single answer any more (does the MRP drop to 225
 * and keep the 50% badge, or does it back-solve to 450?), and every answer to
 * that question is a surprise to somebody. So the field that was ambiguous
 * became the field that is derived, and the pack's own MRP and discount are the
 * only place a price is stated.
 *
 * Products with no pack variants (Femi9's panties, whose sizes all cost the
 * same) are untouched: there `basePrice` is the genuine price, it stays
 * editable, and there is nothing to mirror.
 */
function syncBasePriceWithPacks(args: {
  storedBasePrice: number
  storedVariants: { id: string; kind: string; price: number }[]
  input: ProductInput
}): { basePrice: number } {
  const { storedBasePrice, storedVariants, input } = args

  const storedById = new Map(storedVariants.map((v) => [v.id, v]))
  const incomingPacks = input.variants.filter((v) => v.kind === 'pack')
  if (incomingPacks.length === 0) return { basePrice: input.basePrice }

  // The tiers that carried the old base price — what the storefront leads with.
  let leaders = incomingPacks.filter(
    (v) => v.id && storedById.get(v.id)?.price === storedBasePrice,
  )

  // RECOVERY for rows that have already drifted. A product whose base price
  // matches no tier got that way under the old behaviour — the field saved a
  // number nothing rendered — and it cannot heal itself, because the rule above
  // looks for a tier carrying the OLD base price and there is none. Left like
  // that, the very products an admin noticed were wrong would be the ones that
  // stayed wrong however many times they re-saved them.
  //
  // The storefront falls back to `defaultPack` for these, which is the SMALLEST
  // tier a diaper is sold in beyond the trial pack; here that is the smallest
  // pack that is not the smallest overall when there are three, i.e. the one a
  // shopper is shown by default. Picking the lowest packCount outright would
  // reprice a ₹49 trial pack, which is not the number anybody was editing.
  const drifted = leaders.length === 0
  if (drifted) {
    const byCount = [...incomingPacks].sort((a, b) => (a.packCount ?? 0) - (b.packCount ?? 0))
    const fallback = byCount.length > 2 ? byCount[1] : byCount[0]
    if (fallback?.id) leaders = [fallback]
  }

  // The leading tier's CHARGED price, recomputed from what this save carries.
  // Not the client's `price` field, which is a preview the server does not
  // trust, and not the stored one, which is what we are replacing.
  const leader = leaders[0]
  if (leader) return { basePrice: pricingOf(leader).price }

  // No tier could be identified even after the drift fallback — a product with
  // packs that all have new ids, say. Leave the field alone rather than guess:
  // the next save, once the rows have ids, resolves it.
  return { basePrice: input.basePrice }
}

export async function updateProduct(brand: Brand, id: string, input: ProductInput) {
  const prisma = dbFor(brand)
  const slug = await resolveSlug(brand, input.slug || input.name, id)

  const existing = await prisma.productVariant.findMany({
    where: { productId: id },
    select: { id: true, kind: true, price: true },
  })
  const existingIds = new Set(existing.map((v) => v.id))
  const keptIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id as string))
  const toDelete = [...existingIds].filter((vid) => !keptIds.has(vid))

  const stored = await prisma.product.findUnique({
    where: { id },
    select: { basePrice: true, featured: true, featuredAt: true },
  })
  const sync = syncBasePriceWithPacks({
    storedBasePrice: stored?.basePrice ?? input.basePrice,
    storedVariants: existing,
    input,
  })

  // ── The featured flag ─────────────────────────────────────────────────────
  // Absent from the payload means "leave it alone" (see the schema), so the
  // stored value is the starting point rather than `false`.
  const wasFeatured = stored?.featured ?? false
  let featured = input.featured ?? wasFeatured
  // Asking to feature a draft is an error the admin should see. Un-publishing
  // one that is ALREADY featured is not — that is a normal thing to do, and it
  // simply gives the slot back rather than refusing the save.
  if (input.featured === true) assertFeaturable(input.status)
  if (input.status !== 'active') featured = false

  return prisma.$transaction(async (tx) => {
    // Only when a slot is being CONSUMED. Re-saving an already-featured product
    // must not fail just because the rail is full — it is one of the five.
    if (featured && !wasFeatured) await assertFeaturedCapacity(tx, brand, id)

    await tx.product.update({
      where: { id },
      data: {
        name: input.name,
        slug,
        type: input.type,
        // Reconciled with the pack tiers — see syncBasePriceWithPacks.
        basePrice: sync.basePrice,
        meta: input.meta,
        flow: input.flow,
        description: input.description,
        longDescription: input.longDescription || null,
        tag: input.tag || null,
        status: input.status,
        featured,
        // Keep the ORIGINAL timestamp when it was already featured: a product
        // that is merely re-saved must not jump to the end of the rail, which
        // is what stamping `new Date()` on every write would do.
        featuredAt: featured ? stored?.featuredAt ?? new Date() : null,
      },
    })

    // Images: wipe + rewrite to honour the new order without a per-row diff.
    await tx.productImage.deleteMany({ where: { productId: id } })
    if (input.images.length) {
      await tx.productImage.createMany({
        data: input.images.map((url, i) => ({ productId: id, url, position: i })),
      })
    }

    // Features and specs: same wipe-and-rewrite as images, and for the same
    // reason (an ordered list, no stable client-side ids). Guarded on `!== undefined`
    // so a payload that omits them leaves published content untouched — see the
    // note on the schema fields.
    if (input.features !== undefined) {
      await tx.productFeature.deleteMany({ where: { productId: id } })
      if (input.features.length) {
        await tx.productFeature.createMany({
          data: input.features.map((f, i) => ({
            productId: id,
            title: f.title,
            body: f.body,
            position: i,
          })),
        })
      }
    }

    if (input.specs !== undefined) {
      await tx.productSpec.deleteMany({ where: { productId: id } })
      if (input.specs.length) {
        await tx.productSpec.createMany({
          data: input.specs.map((s, i) => ({
            productId: id,
            key: s.key,
            value: s.value,
            position: i,
          })),
        })
      }
    }

    if (toDelete.length) {
      await tx.productVariant.deleteMany({ where: { id: { in: toDelete } } })
    }

    for (const v of input.variants) {
      // `price` inside is derived from mrp + discountPct — see cleanVariant.
      // Nothing outside that function may set it, which is why the old
      // base-price reprice branch is gone rather than adapted.
      const data = cleanVariant(v)
      if (v.id && existingIds.has(v.id)) {
        await tx.productVariant.update({ where: { id: v.id }, data })
      } else {
        await tx.productVariant.create({ data: { ...data, productId: id } })
      }
    }

    return { id }
  })
}

/**
 * Feature or unfeature one product — the star in the console's products table.
 *
 * A dedicated endpoint rather than a PATCH of the whole product, because this is
 * a one-click action from a LIST: the row has a name and a price, not a variant
 * array, and sending a partial product through `ProductInputSchema` would either
 * fail validation or wipe the fields it could not supply.
 *
 * Returns `null` when the id does not exist (the route turns that into a 404);
 * throws `FeaturedError` when the rail is full or the product is not published.
 */
export async function setProductFeatured(brand: Brand, id: string, featured: boolean) {
  const prisma = dbFor(brand)

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, featured: true },
    })
    if (!product) return null

    // Idempotent: asking for the state it is already in is a no-op, not a
    // "the rail is full" error. Two clicks on a slow connection send two
    // requests, and the second must not be the one that fails.
    if (product.featured === featured) {
      return { id: product.id, name: product.name, featured: product.featured }
    }

    if (!featured) {
      return tx.product.update({
        where: { id },
        data: { featured: false, featuredAt: null },
        select: { id: true, name: true, featured: true },
      })
    }

    assertFeaturable(product.status)
    await assertFeaturedCapacity(tx, brand, id)

    return tx.product.update({
      where: { id },
      data: { featured: true, featuredAt: new Date() },
      select: { id: true, name: true, featured: true },
    })
  })
}

/**
 * Soft-delete: archived products drop out of the storefront (status filter).
 *
 * It also gives up its rail slot. Without that the flag outlives the product:
 * the storefront's `status: 'active'` filter hides the card, so the rail quietly
 * renders four, and the console goes on counting the archived row against the
 * five — a slot nobody can see is taken and nothing can free.
 */
export async function archiveProduct(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  return prisma.product.update({
    where: { id },
    data: { status: 'archived', featured: false, featuredAt: null },
    select: { id: true, status: true },
  })
}

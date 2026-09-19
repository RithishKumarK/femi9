import 'server-only'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Admin pricing-zone service (write side; the read-side resolver lives in
 * ../pricing.ts). A PriceZone is a named bucket that prices two ways — a blanket
 * `discountPct`, plus optional EXACT prices for individual products/variants
 * (the custom price setter) that win wherever they are set. STATE regions are
 * attached via ZoneRegion. Three invariants drive the design:
 *  - a region belongs to at most ONE zone (the @@unique([kind,value]) on
 *    ZoneRegion) — so attaching a state to a zone RE-POINTS it away from
 *    whichever zone held it before, never duplicates it.
 *  - exactly one zone is the `isDefault` fallback — setting a new default unsets
 *    the old one atomically, and the default can never be deleted.
 *  - a product/variant has at most one custom price per zone, and the sent list
 *    is the whole truth: anything the admin cleared is DELETED, so a price can
 *    always be taken back to "follow the discount".
 */

// ─────────────────────────── Validation (zod) ───────────────────────────
// z.coerce so the JSON payload from an <input> ("10") is accepted alongside 10.

/**
 * A custom price is whole rupees, at least ₹1. It is NOT capped at the standard
 * price: a zone may be priced above it, which is the point of typing a price
 * rather than a discount. ₹0 is refused — a free product is never what an admin
 * meant to type, and it would be indistinguishable from an empty box.
 */
const CustomPrice = z.coerce
  .number()
  .int('Whole rupees only')
  .min(1, 'Price must be at least ₹1')
  .max(1_000_000, 'Price is too large')

/**
 * The zone's custom prices, as two lists keyed by what they price. Sending a
 * list REPLACES that list wholesale (see `reconcilePrices`); omitting `prices`
 * leaves existing custom prices untouched.
 */
export const ZonePricesSchema = z.object({
  products: z
    .array(z.object({ productId: z.string().trim().min(1), price: CustomPrice }))
    .default([]),
  variants: z
    .array(z.object({ variantId: z.string().trim().min(1), price: CustomPrice }))
    .default([]),
})

export type ZonePrices = z.infer<typeof ZonePricesSchema>

export const ZoneInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  // 0–100 percent off the base price; a value outside that range is nonsensical.
  discountPct: z.coerce
    .number()
    .int('Whole numbers only')
    .min(0, 'Discount can’t be negative')
    .max(100, 'Discount can’t exceed 100'),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  // State names attached to this zone (kind 'state').
  states: z.array(z.string().trim().min(1)).default([]),
  // Optional so existing callers (and the tests) can create a zone that prices
  // purely by percentage.
  prices: ZonePricesSchema.optional(),
})

export type ZoneInput = z.infer<typeof ZoneInputSchema>

// Update accepts any subset of the same fields (the form may PATCH just one).
export const ZonePatchSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long').optional(),
  discountPct: z.coerce
    .number()
    .int('Whole numbers only')
    .min(0, 'Discount can’t be negative')
    .max(100, 'Discount can’t exceed 100')
    .optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  states: z.array(z.string().trim().min(1)).optional(),
  prices: ZonePricesSchema.optional(),
})

export type ZonePatch = z.infer<typeof ZonePatchSchema>

// ─────────────────────────────── Errors ─────────────────────────────────

/** Thrown when a zone name collides. The route maps this to a friendly 400. */
export class ZoneNameTakenError extends Error {
  constructor(name: string) {
    super(`A pricing zone named “${name}” already exists`)
    this.name = 'ZoneNameTakenError'
  }
}

/** Thrown when a delete targets the default zone. The route maps this to a 400. */
export class CannotDeleteDefaultError extends Error {
  constructor() {
    super('The default pricing zone can’t be deleted')
    this.name = 'CannotDeleteDefaultError'
  }
}

/**
 * Thrown when a PATCH would clear `isDefault` on the only default zone.
 *
 * `deleteZone` already refused to orphan the fallback, but the same store could
 * be left with zero defaults by simply unticking the box — and then every
 * shopper whose state matched no zone resolved to `null`, i.e. no zone at all.
 * (That is how staging ended up with two zones and no default.) The supported
 * way to move the default is to promote another zone, which demotes this one in
 * the same transaction.
 */
export class CannotUnsetDefaultError extends Error {
  constructor() {
    super('Promote another zone to default instead of clearing this one')
    this.name = 'CannotUnsetDefaultError'
  }
}

/**
 * Thrown when a custom price names a product/variant that no longer exists —
 * an editor tab left open across a catalogue change. The route maps it to a 400
 * telling the admin to refresh, rather than a 500 from the FK.
 */
export class UnknownPriceTargetError extends Error {
  constructor(kind: 'product' | 'variant') {
    super(`A custom price refers to a ${kind} that no longer exists - refresh and try again`)
    this.name = 'UnknownPriceTargetError'
  }
}

/** True when `err` is a P2002 unique violation involving the given column. */
function isUniqueOn(err: unknown, field: string): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target
    if (Array.isArray(target)) return target.includes(field)
    if (typeof target === 'string') return target.includes(field)
  }
  return false
}

// ─────────────────────────────── Reads ──────────────────────────────────

/**
 * Every zone in display order, with its attached STATE names, a region count and
 * the custom prices set for it (so the editor can prefill the price boxes and
 * the table can say how many products are priced by hand).
 */
export async function listZones(brand: Brand) {
  const prisma = dbFor(brand)
  const zones = await prisma.priceZone.findMany({
    orderBy: { position: 'asc' },
    include: {
      regions: true,
      productPrices: { select: { productId: true, price: true } },
      variantPrices: { select: { variantId: true, price: true } },
      _count: { select: { regions: true } },
    },
  })
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    discountPct: zone.discountPct,
    isDefault: zone.isDefault,
    active: zone.active,
    position: zone.position,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
    states: zone.regions.filter((r) => r.kind === 'state').map((r) => r.value),
    regionCount: zone._count.regions,
    prices: {
      products: zone.productPrices.map((p) => ({ productId: p.productId, price: p.price })),
      variants: zone.variantPrices.map((v) => ({ variantId: v.variantId, price: v.price })),
    },
  }))
}

/**
 * The catalogue the custom-price editor prices against: every product with its
 * variants and their STANDARD prices, so each box can show what it is
 * overriding.
 *
 * DRAFT products and INACTIVE variants are included, flagged rather than hidden.
 * They are not sellable today, but a price may already be set against one (a
 * product taken to draft after it was priced), and the editor sends the boxes it
 * rendered as the complete truth — so anything it hid would be silently deleted
 * on the next save and lost the moment the product went live again. Archived
 * products are the one exception: those are gone for good.
 */
export async function listPricingCatalog(brand: Brand) {
  const prisma = dbFor(brand)
  const products = await prisma.product.findMany({
    where: { status: { not: 'archived' } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      basePrice: true,
      status: true,
      variants: {
        orderBy: { price: 'asc' },
        select: { id: true, label: true, price: true, active: true },
      },
    },
  })
  return products
}

export type PricingCatalogProduct = Awaited<ReturnType<typeof listPricingCatalog>>[number]

// ─────────────────────────────── Writes ─────────────────────────────────

const dedupeStates = (states: string[]) =>
  [...new Set(states.map((s) => s.trim()).filter(Boolean))]

/**
 * Make this zone's STATE regions exactly `states`. Each wanted state is upserted
 * by its unique [kind,value] to point at THIS zone (moving it off any other zone
 * that held it), and this zone's state regions no longer wanted are removed.
 */
async function reconcileStates(tx: Prisma.TransactionClient, zoneId: string, states: string[]) {
  const wanted = dedupeStates(states)

  for (const value of wanted) {
    await tx.zoneRegion.upsert({
      where: { kind_value: { kind: 'state', value } },
      create: { zoneId, kind: 'state', value },
      update: { zoneId },
    })
  }

  if (wanted.length === 0) {
    await tx.zoneRegion.deleteMany({ where: { zoneId, kind: 'state' } })
  } else {
    await tx.zoneRegion.deleteMany({ where: { zoneId, kind: 'state', value: { notIn: wanted } } })
  }
}

/**
 * Make this zone's custom prices exactly `prices`.
 *
 * The sent lists are the whole truth, deliberately: the editor renders a box per
 * product/variant and sends only the filled ones, so a box the admin CLEARED
 * must delete its row — that is the only way to put an item back on the zone's
 * percentage. A last-write-wins upsert keyed by [zoneId, productId] /
 * [zoneId, variantId] makes a double-submit idempotent rather than a duplicate.
 *
 * Later entries for the same target win, so a payload that somehow lists a
 * product twice resolves to one row instead of failing on the unique index.
 */
async function reconcilePrices(tx: Prisma.TransactionClient, zoneId: string, prices: ZonePrices) {
  const products = new Map(prices.products.map((p) => [p.productId, p.price]))
  const variants = new Map(prices.variants.map((v) => [v.variantId, v.price]))

  // A stale editor tab can carry an id for something since deleted. Checked here
  // so it surfaces as a friendly 400 instead of a raw FK violation (500) that
  // also aborts the rest of the save.
  const productIds = [...products.keys()]
  const variantIds = [...variants.keys()]
  if (productIds.length > 0) {
    const found = await tx.product.count({ where: { id: { in: productIds } } })
    if (found !== productIds.length) throw new UnknownPriceTargetError('product')
  }
  if (variantIds.length > 0) {
    const found = await tx.productVariant.count({ where: { id: { in: variantIds } } })
    if (found !== variantIds.length) throw new UnknownPriceTargetError('variant')
  }

  for (const [productId, price] of products) {
    await tx.zoneProductPrice.upsert({
      where: { zoneId_productId: { zoneId, productId } },
      create: { zoneId, productId, price },
      update: { price },
    })
  }
  // Everything the admin cleared goes away. The filter is built up rather than
  // passed as `notIn: []`, whose compiled meaning is not worth relying on.
  const staleProducts: Prisma.ZoneProductPriceWhereInput = { zoneId }
  if (productIds.length > 0) staleProducts.productId = { notIn: productIds }
  await tx.zoneProductPrice.deleteMany({ where: staleProducts })

  for (const [variantId, price] of variants) {
    await tx.zoneVariantPrice.upsert({
      where: { zoneId_variantId: { zoneId, variantId } },
      create: { zoneId, variantId, price },
      update: { price },
    })
  }
  const staleVariants: Prisma.ZoneVariantPriceWhereInput = { zoneId }
  if (variantIds.length > 0) staleVariants.variantId = { notIn: variantIds }
  await tx.zoneVariantPrice.deleteMany({ where: staleVariants })
}

export async function createZone(brand: Brand, input: ZoneInput) {
  const prisma = dbFor(brand)
  try {
    return await prisma.$transaction(async (tx) => {
      // A single default: promoting this one demotes every other.
      if (input.isDefault) {
        await tx.priceZone.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
      }
      const zone = await tx.priceZone.create({
        data: {
          name: input.name,
          discountPct: input.discountPct,
          active: input.active,
          isDefault: input.isDefault,
        },
      })
      await reconcileStates(tx, zone.id, input.states)
      if (input.prices) await reconcilePrices(tx, zone.id, input.prices)
      return zone
    })
  } catch (err) {
    if (isUniqueOn(err, 'name')) throw new ZoneNameTakenError(input.name)
    throw err
  }
}

export async function updateZone(brand: Brand, id: string, patch: ZonePatch) {
  const prisma = dbFor(brand)
  try {
    return await prisma.$transaction(async (tx) => {
      if (patch.isDefault === true) {
        await tx.priceZone.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        })
      } else if (patch.isDefault === false) {
        // Demoting the default leaves the store with no fallback price.
        const current = await tx.priceZone.findUnique({
          where: { id },
          select: { isDefault: true },
        })
        if (current?.isDefault) throw new CannotUnsetDefaultError()
      }

      const data: Prisma.PriceZoneUpdateInput = {}
      if (patch.name !== undefined) data.name = patch.name
      if (patch.discountPct !== undefined) data.discountPct = patch.discountPct
      if (patch.active !== undefined) data.active = patch.active
      if (patch.isDefault !== undefined) data.isDefault = patch.isDefault

      // A missing row surfaces as P2025 → the route 404s.
      const zone = await tx.priceZone.update({ where: { id }, data })

      // Only reconcile when the caller actually sent a state list.
      if (patch.states !== undefined) await reconcileStates(tx, id, patch.states)
      // Same for custom prices: a PATCH that omits `prices` leaves them alone,
      // one that sends them replaces the lot.
      if (patch.prices !== undefined) await reconcilePrices(tx, id, patch.prices)

      return zone
    })
  } catch (err) {
    if (isUniqueOn(err, 'name')) throw new ZoneNameTakenError(patch.name ?? '')
    throw err
  }
}

export async function deleteZone(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  const zone = await prisma.priceZone.findUnique({ where: { id }, select: { isDefault: true } })
  // Never orphan the fallback — a store must always have a default price.
  if (zone?.isDefault) throw new CannotDeleteDefaultError()
  // If the zone is already gone, delete throws P2025 → the route 404s.
  // Regions cascade via the FK's onDelete: Cascade.
  return prisma.priceZone.delete({ where: { id }, select: { id: true } })
}

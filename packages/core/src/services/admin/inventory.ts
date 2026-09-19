import 'server-only'
import { Prisma, type ProductType } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Admin inventory service — the single seam for reading + mutating stock levels
 * per product variant. The storefront reads variants through
 * `src/lib/services/products.ts`; this module is the write side used only by the
 * guarded admin console.
 */

/**
 * Below this on-hand count a variant is surfaced as "low stock" so ops can
 * reorder before it sells out. Kept as a shared constant so the flag is defined
 * in exactly one place (the client page mirrors this value for its own summary).
 */
export const LOW_STOCK_THRESHOLD = 40

export interface InventoryRow {
  variantId: string
  productId: string
  productName: string
  productSlug: string
  // The shared ProductType, not Femi9's two values — Lumi9 files diapers here.
  productType: ProductType
  kind: 'pack' | 'size'
  label: string
  sku: string | null
  price: number
  stock: number
  active: boolean
  /** stock < LOW_STOCK_THRESHOLD — precomputed so every consumer agrees. */
  lowStock: boolean
}

// The exact include used everywhere so mapping stays consistent across reads/writes.
const withProduct = {
  product: { select: { id: true, name: true, slug: true, type: true } },
} satisfies Prisma.ProductVariantInclude

type VariantWithProduct = Prisma.ProductVariantGetPayload<{ include: typeof withProduct }>

function toRow(v: VariantWithProduct): InventoryRow {
  return {
    variantId: v.id,
    productId: v.productId,
    productName: v.product.name,
    productSlug: v.product.slug,
    productType: v.product.type,
    kind: v.kind,
    label: v.label,
    sku: v.sku,
    price: v.price,
    stock: v.stock,
    active: v.active,
    lowStock: v.stock < LOW_STOCK_THRESHOLD,
  }
}

/** True when a write targeted a variant id that no longer exists. */
function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

/**
 * Every variant across the catalog (active + inactive), each carrying its parent
 * product name so the admin table can group by product. Sorted by product name,
 * then price, so the page can build ordered groups by simple iteration.
 */
export async function listInventory(brand: Brand): Promise<InventoryRow[]> {
  const prisma = dbFor(brand)
  try {
    const variants = await prisma.productVariant.findMany({
      orderBy: [{ product: { name: 'asc' } }, { price: 'asc' }],
      include: withProduct,
    })
    return variants.map(toRow)
  } catch {
    return []
  }
}

/**
 * Set an absolute on-hand count. Clamped to >= 0 defensively (callers other than
 * the zod-validated route could pass anything). Returns null when the variant is
 * gone so the route can answer 404 instead of a 500.
 */
export async function setStock(brand: Brand, variantId: string, stock: number): Promise<InventoryRow | null> {
  const prisma = dbFor(brand)
  const next = Math.max(0, Math.trunc(stock))
  try {
    const v = await prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: next },
      include: withProduct,
    })
    return toRow(v)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/**
 * Apply a relative delta (e.g. +1 / -5), clamped so stock never goes below zero.
 *
 * Every write is an ATOMIC, server-side operation — an `increment`/`decrement`
 * or a conditional guard, never an absolute value computed from a stale read —
 * so two concurrent adjustments can't clobber each other (the lost-update bug).
 */
export async function adjustStock(brand: Brand, variantId: string, delta: number): Promise<InventoryRow | null> {
  const prisma = dbFor(brand)
  const step = Math.trunc(delta)
  try {
    // Restock (or no-op): a single atomic increment. Nothing to floor.
    if (step >= 0) {
      const v = await prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: { increment: step } },
        include: withProduct,
      })
      return toRow(v)
    }

    // Drawdown: decrement atomically, floored at 0. Both writes are conditional
    // guards on the live row, so a concurrent change is never lost.
    const need = -step
    return await prisma.$transaction(async (tx) => {
      // Fast path: enough on hand → atomic conditional decrement.
      const dec = await tx.productVariant.updateMany({
        where: { id: variantId, stock: { gte: need } },
        data: { stock: { decrement: need } },
      })
      if (dec.count === 0) {
        // Not enough on hand (or the variant is gone). Floor to 0 ONLY for a row
        // that is genuinely below the drawdown — this guard means a concurrent
        // restock that lifted stock to >= need won't be clobbered back to 0.
        await tx.productVariant.updateMany({
          where: { id: variantId, stock: { lt: need } },
          data: { stock: 0 },
        })
      }
      const v = await tx.productVariant.findUnique({ where: { id: variantId }, include: withProduct })
      return v ? toRow(v) : null
    })
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

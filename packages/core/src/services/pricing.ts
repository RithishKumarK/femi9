import 'server-only'
import { cache } from 'react'
import { dbFor, type Brand, type PrismaClient } from '@femi9/db'

/**
 * Regional-pricing resolver (read side).
 *
 * Given whatever location signal we have for a visitor, resolve their PriceZone
 * and apply its discount to a base price. The zone is chosen by the STRONGEST
 * available signal first (pincode → district → state), falling back to the
 * `isDefault` zone (standard price) when nothing matches — so an unknown
 * location always gets the standard price, never a broken one.
 *
 * A zone prices in one of two ways:
 *
 *   discountPct  — a blanket percentage off every product in the zone.
 *   overrides    — an EXACT rupee price the admin typed for one product or one
 *                  variant (ZoneProductPrice / ZoneVariantPrice). Where an
 *                  override exists the percentage is not consulted at all.
 *
 * A percentage can only ever mark down, but a typed price is whatever the admin
 * typed — so unlike the discount-only design this replaced, a zone price is no
 * longer guaranteed to be ≤ the standard price. Every display that shows "you
 * saved X" must therefore check that the number actually moved DOWN rather than
 * assume it (see `getCart`, which only reports a zone when it did).
 *
 * Two entry points, and the difference matters:
 *
 *   resolveZone(signal)   — explicit. `placeOrder` passes the DELIVERY ADDRESS,
 *                           which is the only signal that decides real money.
 *   resolveAmbientZone(brand)  — best guess for a browsing visitor: her saved
 *                           address, else CloudFront edge geo, else default.
 *                           Request-cached, so a page that renders a grid, a
 *                           cart and a summary resolves it once.
 *
 * Display used to skip both and print `variant.price` raw, so a shopper in a
 * discounted zone saw the standard price on the card, in the cart and on the
 * checkout Total — and only found out at the Razorpay sheet that she was being
 * charged less. Every read path now goes through a zone.
 */

/**
 * The exact prices an admin typed for this zone, keyed by what they price.
 * Absent keys fall through to `discountPct`.
 */
export interface ZoneOverrides {
  /** productId → the card / headline price for that product in this zone. */
  products: Record<string, number>
  /** variantId → what a cart line for that variant is charged in this zone. */
  variants: Record<string, number>
}

export interface ResolvedZone {
  id: string
  name: string
  discountPct: number
  isDefault: boolean
  overrides: ZoneOverrides
}

/**
 * WHAT is being priced, so a custom price can be found for it.
 *
 * A product override prices the product's headline only — it deliberately does
 * NOT cascade to the variants, because "₹180 for this product" cannot mean the
 * same thing for a 9-pack and an 18-pack. Pass `variantId` when pricing a
 * variant and `productId` when pricing the card; passing both would be a
 * category error, so callers pass exactly one.
 */
export interface PriceTarget {
  productId?: string | null
  variantId?: string | null
}

export interface LocationSignal {
  pincode?: string | null
  district?: string | null
  state?: string | null
}

/** A zone with no custom prices — every product follows `discountPct`. */
export const NO_OVERRIDES: ZoneOverrides = { products: {}, variants: {} }

/**
 * A Prisma client or an open transaction — callers already inside a
 * `$transaction` pass `tx` so this read joins their transaction instead of
 * borrowing a second pooled connection while the first is held.
 */
type Db = Pick<PrismaClient, 'zoneRegion' | 'priceZone' | 'zoneProductPrice' | 'zoneVariantPrice'>

/** Resolve the applicable zone for a location, or the default zone, or null. */
export async function resolveZone(brand: Brand, signal: LocationSignal, db: Db = dbFor(brand)): Promise<ResolvedZone | null> {
  // Strongest signal first. Pincode is matched by its leading-3 prefix, since a
  // ZoneRegion of kind 'pincode' stores a prefix (e.g. "641" for the Coimbatore area).
  const candidates: { kind: 'pincode' | 'district' | 'state'; value: string }[] = []
  const pin = signal.pincode?.replace(/\D/g, '')
  if (pin && pin.length >= 3) candidates.push({ kind: 'pincode', value: pin.slice(0, 3) })
  if (signal.district?.trim()) candidates.push({ kind: 'district', value: signal.district.trim() })
  if (signal.state?.trim()) candidates.push({ kind: 'state', value: signal.state.trim() })

  for (const c of candidates) {
    const region = await db.zoneRegion.findFirst({
      where: {
        kind: c.kind,
        value: { equals: c.value, mode: 'insensitive' },
        zone: { active: true },
      },
      include: { zone: true },
    })
    if (region) {
      return {
        id: region.zone.id,
        name: region.zone.name,
        discountPct: region.zone.discountPct,
        isDefault: region.zone.isDefault,
        overrides: await loadOverrides(region.zone.id, db),
      }
    }
  }

  const def = await db.priceZone.findFirst({ where: { isDefault: true, active: true } })
  return def
    ? {
        id: def.id,
        name: def.name,
        discountPct: def.discountPct,
        isDefault: true,
        overrides: await loadOverrides(def.id, db),
      }
    : null
}

/**
 * Every custom price the admin typed for this zone, as two flat maps.
 *
 * Read in one go rather than per line: a cart of six lines would otherwise cost
 * six round trips, and both tables hold at most (zones × catalogue) rows. The
 * two reads are sequential on purpose — `db` may be an interactive transaction
 * client, which owns a single connection.
 */
async function loadOverrides(zoneId: string, db: Db): Promise<ZoneOverrides> {
  const productRows = await db.zoneProductPrice.findMany({
    where: { zoneId },
    select: { productId: true, price: true },
  })
  const variantRows = await db.zoneVariantPrice.findMany({
    where: { zoneId },
    select: { variantId: true, price: true },
  })

  const products: Record<string, number> = {}
  for (const r of productRows) products[r.productId] = r.price
  const variants: Record<string, number> = {}
  for (const r of variantRows) variants[r.variantId] = r.price
  return { products, variants }
}

/**
 * The custom price set for `target` in this zone, or null when the zone prices
 * it by percentage. A variant is never priced off its product's override — see
 * `PriceTarget`.
 */
export function zoneCustomPrice(
  zone: { overrides?: ZoneOverrides | null } | null,
  target?: PriceTarget,
): number | null {
  const overrides = zone?.overrides
  if (!overrides || !target) return null

  if (target.variantId) {
    const price = overrides.variants[target.variantId]
    return typeof price === 'number' ? price : null
  }
  if (target.productId) {
    const price = overrides.products[target.productId]
    return typeof price === 'number' ? price : null
  }
  return null
}

/**
 * The price to charge/show for `basePrice` in this zone: the custom price the
 * admin typed for `target` if there is one, otherwise the base with the zone's
 * percentage taken off.
 *
 * `target` is optional so a caller with nothing to key on (a bare amount) still
 * gets the percentage behaviour, but every catalogue/cart/order path passes it —
 * omitting it silently downgrades a custom price back to the discount.
 */
export function applyZonePrice(
  basePrice: number,
  zone: { discountPct: number; overrides?: ZoneOverrides | null } | null,
  target?: PriceTarget,
): number {
  const custom = zoneCustomPrice(zone, target)
  if (custom !== null) return Math.max(0, Math.round(custom))

  const pct = Math.max(0, Math.min(100, zone?.discountPct ?? 0))
  return Math.round((basePrice * (100 - pct)) / 100)
}

/**
 * The zone to PRICE A BROWSING VISITOR at, from the best signal available
 * without asking her to type anything:
 *
 *   1. her saved primary address, if she is signed in — she has already told us
 *      where this ships, and it beats an IP guess (mobile carrier NAT routinely
 *      places a Chennai phone in Maharashtra);
 *   2. CloudFront edge geo for everyone else;
 *   3. the default zone.
 *
 * `cache()` scopes the result to one request, so the catalog grid, the cart and
 * the checkout summary agree with each other and cost one query between them.
 *
 * Never throws: any failure (no request scope, a DB blip, no session) degrades
 * to the default zone, i.e. the standard price.
 */
export const resolveAmbientZone = cache(async (brand: Brand): Promise<ResolvedZone | null> => {
  try {
    const saved = await savedAddressSignal(brand)
    if (saved) {
      const zone = await resolveZone(brand, saved)
      if (zone) return zone
    }

    // Imported lazily: this module is also loaded by cron/CLI paths that have no
    // request scope, and `next/headers` need not be dragged in for them.
    const { detectGeoSignal } = await import('../geo/detect')
    const geo = await detectGeoSignal(brand)
    return await resolveZone(brand, geo)
  } catch {
    return null
  }
})

/** The signed-in shopper's primary delivery address, as a location signal. */
async function savedAddressSignal(brand: Brand): Promise<LocationSignal | null> {
  const prisma = dbFor(brand)
  const { getSession } = await import('../auth')
  const session = await getSession(brand)
  if (!session) return null

  const address = await prisma.address.findFirst({
    where: { userId: session.sub, archivedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { id: 'desc' }],
    select: { state: true, pincode: true },
  })
  if (!address?.state && !address?.pincode) return null
  return { state: address.state, pincode: address.pincode }
}

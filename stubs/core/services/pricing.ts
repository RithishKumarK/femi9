/**
 * Zone pricing — resolves to "no overrides".
 *
 * The real service reads `PriceZone` + `ZoneProductPrice` / `ZoneVariantPrice`
 * and lets an exact zone price beat the zone's percentage discount. The fixture
 * catalogue has no zones, so every location resolves to the default zone and
 * every product quotes its base price.
 *
 * Note what is preserved even so: pricing is still resolved SERVER-side and the
 * caller still passes the address it is pricing for. The stub returns the same
 * shape the real resolver does, so no caller learns to skip the step.
 */

import type { Brand } from '../../db'

export interface ResolvedZone {
  id: string
  name: string
  discountPct: number
  isDefault: boolean
}

/** The "this zone changes nothing" answer, exported because callers compare against it. */
export const NO_OVERRIDES: ResolvedZone = {
  id: 'default',
  name: 'India (standard)',
  discountPct: 0,
  isDefault: true,
}

export async function resolveZone(
  _brand: Brand,
  _where?: { state?: string; pincode?: string; country?: string },
): Promise<ResolvedZone> {
  return NO_OVERRIDES
}

/** Base price in, zone price out. With no overrides it is the identity. */
export function applyZonePrice(basePrice: number, zone?: ResolvedZone | null): number {
  if (!zone || zone.discountPct <= 0) return basePrice
  // Integer rupees, never floats or paise.
  return Math.round((basePrice * (100 - zone.discountPct)) / 100)
}

export async function zoneCustomPrice(
  _brand: Brand,
  _zoneId: string,
  _target: { productId?: string; variantId?: string },
): Promise<number | null> {
  return null
}

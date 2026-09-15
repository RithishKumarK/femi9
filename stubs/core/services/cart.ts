/**
 * The cart — a real, working cart, held in memory.
 *
 * This is the one stub worth making behave properly rather than throwing. The
 * cart drawer, the "Add to cart" pulse, the free-shipping bar and the pack
 * picker are all front-end behaviour, and none of them can be looked at unless
 * something on the server remembers what was added.
 *
 * Lines are keyed by the guest token the route handler already mints, so two
 * browsers get two carts exactly as they would against Postgres. The Map dies
 * with the dev server, which is the honest lifetime for a preview.
 *
 * Prices are read from the catalogue fixture, never from the client. That rule
 * is worth keeping even in a stub: it is the one the real service exists to
 * enforce.
 */

import type { Brand } from '../../db'
import { findVariant } from './products'
import { StubDomainError } from '../_unavailable'

export class UnknownVariantError extends StubDomainError {}

export interface CartItemDTO {
  variantId: string
  productSlug: string
  name: string
  variantLabel: string
  unitPrice: number
  qty: number
  lineTotal: number
  img: string
}

export interface CartDTO {
  items: CartItemDTO[]
  subtotal: number
  count: number
}

export const EMPTY_CART: CartDTO = { items: [], subtotal: 0, count: 0 }

/**
 * token -> (variantId -> qty).
 *
 * Parked on `globalThis`, and that is not incidental. Next compiles route
 * handlers and server components into SEPARATE server bundles, so a plain
 * module-level `Map` gives `/api/cart` one cart and the `/checkout` server
 * component a different, empty one — the drawer would fill up and the checkout
 * summary would keep saying "your bag is empty". One global object is the only
 * thing both bundles can see. (It also survives a dev hot-reload, which the
 * real Postgres-backed cart does for free.)
 */
const carts: Map<string, Map<string, number>> =
  ((globalThis as Record<string, unknown>).__femi9StubCarts as Map<string, Map<string, number>>) ??
  ((globalThis as Record<string, unknown>).__femi9StubCarts = new Map())

function linesFor(token: string): Map<string, number> {
  let lines = carts.get(token)
  if (!lines) {
    lines = new Map()
    carts.set(token, lines)
  }
  return lines
}

/** Re-price every line from the catalogue and total it. */
function render(token: string): CartDTO {
  const items: CartItemDTO[] = []
  for (const [variantId, qty] of linesFor(token)) {
    const found = findVariant(variantId)
    if (!found) continue
    const { product, variant } = found
    items.push({
      variantId,
      productSlug: product.id,
      name: product.name,
      variantLabel: variant.label,
      unitPrice: variant.price,
      qty,
      lineTotal: variant.price * qty,
      img: product.img,
    })
  }
  return {
    items,
    subtotal: items.reduce((sum, i) => sum + i.lineTotal, 0),
    count: items.reduce((sum, i) => sum + i.qty, 0),
  }
}

/**
 * `zone` is accepted and ignored. The checkout page passes the zone it resolved
 * so the summary is priced where the parcel is going; the fixture catalogue has
 * no zone overrides, so every zone quotes the base price.
 */
export async function getCart(
  _brand: Brand,
  token: string,
  _zone?: unknown,
): Promise<CartDTO> {
  return render(token)
}

export async function addItem(
  _brand: Brand,
  token: string,
  variantId: string,
  qty = 1,
): Promise<CartDTO> {
  if (!findVariant(variantId)) throw new UnknownVariantError(variantId)
  const lines = linesFor(token)
  lines.set(variantId, Math.min(99, (lines.get(variantId) ?? 0) + qty))
  return render(token)
}

export async function setQty(
  _brand: Brand,
  token: string,
  variantId: string,
  qty: number,
): Promise<CartDTO> {
  const lines = linesFor(token)
  if (qty <= 0) lines.delete(variantId)
  else if (findVariant(variantId)) lines.set(variantId, Math.min(99, qty))
  return render(token)
}

export async function removeItem(
  _brand: Brand,
  token: string,
  variantId: string,
): Promise<CartDTO> {
  linesFor(token).delete(variantId)
  return render(token)
}

/** Sign-in hand-off. There are no accounts against a stub, so this is a no-op. */
export async function mergeGuestCartIntoUser(
  _brand: Brand,
  _token: string,
  _userId: string,
): Promise<void> {
  /* nothing to merge: the stub has no signed-in carts */
}

import { cookies } from 'next/headers'

/**
 * Guest session helpers.
 *
 * Anonymous carts are keyed by an opaque token carried in an httpOnly cookie.
 * Auth arrives in a later phase; until then every visitor is a guest, so the
 * cookie is the only thing tying repeat requests to the same `Cart` row.
 */

export const GUEST_COOKIE = 'femi9_cart'

/** The token on the current request, or null if this visitor has no cart yet. */
export async function getGuestToken(): Promise<string | null> {
  return (await cookies()).get(GUEST_COOKIE)?.value ?? null
}

/** Mint a token for a first-time visitor. The caller is responsible for
 *  persisting it back onto the response cookie (see the cart POST handler). */
export function newGuestToken(): string {
  return crypto.randomUUID()
}

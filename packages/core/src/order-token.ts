import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Capability token for the order-confirmation page.
 *
 * The confirmation page (app/(store)/order/[orderNo]/page.tsx) renders the
 * customer's name, address and phone. Order numbers are short and sequential, so
 * without a secret an attacker could enumerate them and scrape that PII (IDOR).
 * We gate the page behind an unguessable, stateless HMAC of the order number
 * keyed with AUTH_SECRET: the shopper — including guests, who have no session —
 * gets it back from the checkout response and carries it in the ?t= query param.
 *
 * Stateless (nothing stored) and cheap to verify. Runs only in the Node runtime
 * (route handlers + server components); node:crypto is unavailable on the edge.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return s
}

/** base64url(HMAC-SHA256(orderNo, AUTH_SECRET)) — the capability token. */
export function orderToken(orderNo: string): string {
  return createHmac('sha256', secret()).update(orderNo).digest('base64url')
}

/**
 * Constant-time check that `token` is the valid capability for `orderNo`.
 * Returns false for a missing/empty token or any length mismatch (which also
 * keeps timingSafeEqual from throwing on unequal-length buffers).
 */
export function verifyOrderToken(orderNo: string, token: string | null | undefined): boolean {
  if (!token) return false
  const expected = Buffer.from(orderToken(orderNo))
  const provided = Buffer.from(token)
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

/**
 * Cadence maths for the mandate. Pure, kept real.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { StubDomainError } from '../_unavailable'

export class UnsupportedCadenceError extends StubDomainError {}

export function rhythmForDays(days: number): { period: 'weekly' | 'monthly'; interval: number } {
  if (days % 30 === 0) return { period: 'monthly', interval: days / 30 }
  if (days % 7 === 0) return { period: 'weekly', interval: days / 7 }
  // Razorpay has no "every N days" primitive; the real service rounds to the
  // nearest whole week rather than inventing a cadence the gateway rejects.
  return { period: 'weekly', interval: Math.max(1, Math.round(days / 7)) }
}

export function planFingerprint(variantId: string, qty: number, days: number): string {
  return `${variantId}:${qty}:${days}`
}

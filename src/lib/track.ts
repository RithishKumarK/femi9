'use client'

/**
 * Fire-and-forget storefront analytics.
 *
 * `/api/events` is a complete, rate-limited endpoint writing to EventLog — and
 * it had zero callers. Not one storefront interaction was ever recorded, so the
 * table and the route were dead weight while the admin analytics had nothing
 * behavioural to read. This is the missing client half.
 *
 * Deliberately silent and non-blocking: analytics must never delay an add-to-cart,
 * surface an error to a shopper, or fail a checkout because a beacon 500'd. Every
 * failure — offline, rate-limited, blocked by an extension — is swallowed.
 *
 * PII: pass identifiers and short labels only. Never an email, a phone number, a
 * coupon code or anything from a cycle log; EventLog is not encrypted.
 */
export function track(type: string, meta?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return

  const body = JSON.stringify({ type, meta: meta ?? {} })

  // sendBeacon survives the page unload that follows a checkout redirect, which
  // is exactly when the most valuable events fire. Fall back to fetch+keepalive.
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon('/api/events', blob)) return
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

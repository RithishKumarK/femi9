/**
 * Open-redirect guard for the `?next=` parameter that carries a shopper back to
 * where they were before we bounced them to /login or /welcome.
 *
 * Deliberately dependency-free (no 'server-only', no next/server) so the route
 * handlers, the middleware and the client-side /login and /welcome screens can
 * all share ONE rule. A redirect guard that exists in three slightly different
 * copies is a redirect guard that is wrong in at least one of them.
 *
 * Accepted: a same-origin absolute path — "/account", "/thara", "/product/x?y=1".
 * Rejected: anything protocol-relative ("//evil.com", which a browser resolves
 * as a different host), any absolute URL, and any /api path (a top-level
 * navigation to a JSON endpoint is never a destination a person wanted).
 */
export function safeNextPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const next = value.trim()
  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//')) return fallback
  // Backslashes are normalised to slashes by some browsers, so "/\evil.com"
  // would otherwise slip past the protocol-relative check above.
  if (next.startsWith('/\\')) return fallback
  if (next === '/api' || next.startsWith('/api/')) return fallback
  return next
}

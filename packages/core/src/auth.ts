import 'server-only'
import { cookies } from 'next/headers'
import type { Brand } from '@femi9/db'
import { sessionCookieName, verifySession, type CustomerSession } from './customer-session'

/**
 * Customer (storefront) session — the request-scoped half.
 *
 * Token mechanics live in `./customer-session`, which carries no `server-only`
 * and no `next/headers`, so a route guard can verify a cookie before any
 * handler runs. This module is what reads the cookie jar.
 *
 * Deliberately SEPARATE from the admin session: a shopper's cookie has its own
 * name AND its own audience, so signing into a storefront can never grant the
 * ops console, and vice-versa. Sessions are also per BRAND, for the same
 * reason — both brands sign with the same secret, so the audience is the only
 * thing keeping a Lumi9 token out of Femi9.
 *
 * The token is the identity; `sub` is User.id. phone/email/name ride along as
 * convenience claims so common reads (a greeting, a prefill) need no database
 * hit — anything trust-sensitive must re-read by `sub`.
 */

export type { CustomerSession }
export {
  createSession,
  verifySession,
  sessionCookieName,
  customerAudience,
  SESSION_MAX_AGE,
} from './customer-session'

/** @deprecated Femi9's cookie name. Use `sessionCookieName(brand)`. */
export const SESSION_COOKIE = 'femi9_session'

/** Read + verify this request's session for one brand. */
export async function getSession(brand: Brand): Promise<CustomerSession | null> {
  const token = (await cookies()).get(sessionCookieName(brand))?.value
  return verifySession(brand, token)
}

/**
 * Guard for route handlers. Same semantics as `getSession` (the session, or
 * null) but named for the call site — handlers read
 * `const u = await requireUser(brand); if (!u) return unauthorized()`.
 */
export async function requireUser(brand: Brand): Promise<CustomerSession | null> {
  return getSession(brand)
}

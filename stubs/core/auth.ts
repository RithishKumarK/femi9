/**
 * Customer sessions — always signed out.
 *
 * The real module verifies an HS256 JWT out of the `femi9_session` cookie with
 * `jose`. Minting a session here would be worse than useless: the pages behind
 * one (/account, /dashboard, /welcome) read customer rows out of Postgres, so a
 * fake session would walk you past the guard and straight into a crash.
 *
 * Signed out is the state the whole public storefront is designed around, and
 * it is the state every one of its surfaces renders correctly in.
 */

import { unavailable } from './_unavailable'
import type { Brand } from '../db'

export const SESSION_COOKIE = 'femi9_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export interface Session {
  /** User id. */
  sub: string
  email?: string
  phone?: string
  name?: string
}

export async function getSession(_brand: Brand): Promise<Session | null> {
  return null
}

export async function verifySession(_brand: Brand, _token: string): Promise<Session | null> {
  return null
}

export async function requireUser(_brand: Brand): Promise<Session> {
  return unavailable('Signing in')
}

export async function createSession(_brand: Brand, _userId: string): Promise<string> {
  return unavailable('Signing in')
}

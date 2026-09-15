/**
 * The signed referral-attribution cookie.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from '../_unavailable'

export const THARA_REF_COOKIE = 'femi9_thara_ref'
export const THARA_REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export async function signTharaRefCookie(..._args: unknown[]): Promise<never> {
  return unavailable('signTharaRefCookie')
}

export async function verifyTharaRefCookie(..._args: unknown[]): Promise<never> {
  return unavailable('verifyTharaRefCookie')
}

/**
 * Signed token letting a guest re-open their own order confirmation.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export async function verifyOrderToken(_orderNo: string, _token: string): Promise<boolean> {
  // Signed out and no signing key: an unverifiable token must read as invalid,
  // never as valid.
  return false
}

export async function orderToken(..._args: unknown[]): Promise<never> {
  return unavailable('orderToken')
}

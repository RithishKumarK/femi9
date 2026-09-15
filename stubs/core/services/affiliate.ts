/**
 * Affiliate short links and click attribution.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from '../_unavailable'

export function refCookieName(): string {
  return 'femi9_ref'
}

export async function apply(..._args: unknown[]): Promise<never> {
  return unavailable('apply')
}

export async function getForUser(..._args: unknown[]): Promise<never> {
  return unavailable('getForUser')
}

export async function logClick(..._args: unknown[]): Promise<never> {
  return unavailable('logClick')
}

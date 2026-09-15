/**
 * Accept-Language hints, cross-checked against the state.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from '../_unavailable'

export async function languageHint(..._args: unknown[]): Promise<never> {
  return unavailable('languageHint')
}

export async function contradictsState(..._args: unknown[]): Promise<never> {
  return unavailable('contradictsState')
}

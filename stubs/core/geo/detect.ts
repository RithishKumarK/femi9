/**
 * Ambient location signal from edge headers + MMDB.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from '../_unavailable'

export async function detectGeoSignal(..._args: unknown[]): Promise<never> {
  return unavailable('detectGeoSignal')
}

export async function toIndiaState(..._args: unknown[]): Promise<never> {
  return unavailable('toIndiaState')
}

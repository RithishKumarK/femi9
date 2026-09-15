/**
 * MaxMind lookups. Needs the .mmdb file fetched by geoip:fetch.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from '../_unavailable'

export async function lookupCity(..._args: unknown[]): Promise<never> {
  return unavailable('lookupCity')
}

export async function lookupAsn(..._args: unknown[]): Promise<never> {
  return unavailable('lookupAsn')
}

export async function mmdbReady(..._args: unknown[]): Promise<never> {
  return unavailable('mmdbReady')
}

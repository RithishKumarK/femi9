/**
 * Console price-zone editing.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../../_unavailable'

export class CannotDeleteDefaultError extends StubDomainError {}
export class CannotUnsetDefaultError extends StubDomainError {}

export async function createZone(..._args: unknown[]): Promise<never> {
  return unavailable('createZone')
}

export async function deleteZone(..._args: unknown[]): Promise<never> {
  return unavailable('deleteZone')
}

export async function updateZone(..._args: unknown[]): Promise<never> {
  return unavailable('updateZone')
}

/**
 * Shopper questions on a product page.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export class ProductNotFoundError extends StubDomainError {}

export async function submitQuestion(..._args: unknown[]): Promise<never> {
  return unavailable('submitQuestion')
}

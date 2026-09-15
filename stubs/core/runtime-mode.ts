/**
 * Whether mock providers may stand in for real ones.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { StubDomainError } from './_unavailable'

export class ProviderConfigurationError extends StubDomainError {}

export function mockProvidersAllowed(): boolean {
  return process.env.NODE_ENV !== 'production'
}

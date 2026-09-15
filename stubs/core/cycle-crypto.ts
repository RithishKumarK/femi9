/**
 * Cycle payloads are encrypted at rest with CYCLE_DATA_ENCRYPTION_KEY.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export async function encryptCyclePayload(..._args: unknown[]): Promise<never> {
  return unavailable('encryptCyclePayload')
}

export async function decryptCyclePayload(..._args: unknown[]): Promise<never> {
  return unavailable('decryptCyclePayload')
}

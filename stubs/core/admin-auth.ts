/**
 * The ops console moved to apps/admin; this app no longer mints an admin cookie.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export async function requireAdmin(..._args: unknown[]): Promise<never> {
  return unavailable('requireAdmin')
}

export async function getAdminSession(..._args: unknown[]): Promise<never> {
  return unavailable('getAdminSession')
}

export async function createSession(..._args: unknown[]): Promise<never> {
  return unavailable('createSession')
}

export async function verifySession(..._args: unknown[]): Promise<never> {
  return unavailable('verifySession')
}

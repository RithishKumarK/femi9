/**
 * Google sign-in. No client id is configured against a stub.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export interface GoogleProfile { sub: string; email: string; name?: string; picture?: string }

export const OAUTH_STATE_COOKIE = 'femi9_oauth_state'
export const OAUTH_NEXT_COOKIE = 'femi9_oauth_next'

export function googleConfigured(): boolean {
  return false
}

export async function buildConsentUrl(..._args: unknown[]): Promise<never> {
  return unavailable('buildConsentUrl')
}

export async function callbackUrl(..._args: unknown[]): Promise<never> {
  return unavailable('callbackUrl')
}

export async function exchangeCodeForProfile(..._args: unknown[]): Promise<never> {
  return unavailable('exchangeCodeForProfile')
}

export async function generateState(..._args: unknown[]): Promise<never> {
  return unavailable('generateState')
}

export async function mockProfile(..._args: unknown[]): Promise<never> {
  return unavailable('mockProfile')
}

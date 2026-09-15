/**
 * Sign-in one-time codes and magic links (Resend / MSG91).
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export function emailConfigured(): boolean {
  return false
}

export function smsConfigured(): boolean {
  return false
}

export async function generateCode(..._args: unknown[]): Promise<never> {
  return unavailable('generateCode')
}

export async function generateToken(..._args: unknown[]): Promise<never> {
  return unavailable('generateToken')
}

export async function hashCode(..._args: unknown[]): Promise<never> {
  return unavailable('hashCode')
}

export async function sendMagicLink(..._args: unknown[]): Promise<never> {
  return unavailable('sendMagicLink')
}

export async function sendSms(..._args: unknown[]): Promise<never> {
  return unavailable('sendSms')
}

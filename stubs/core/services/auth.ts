/**
 * Sign-in: OTP, magic links, Google, identity attachment.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export class IdentityConflictError extends StubDomainError {}
export class InvalidEmailError extends StubDomainError {}
export class InvalidOtpError extends StubDomainError {}
export class InvalidPhoneError extends StubDomainError {}

/** Pure normalisation, kept real. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

export async function assertIdentityFree(..._args: unknown[]): Promise<never> {
  return unavailable('assertIdentityFree')
}

export async function attachIdentity(..._args: unknown[]): Promise<never> {
  return unavailable('attachIdentity')
}

export async function dispatchEmailVerification(..._args: unknown[]): Promise<never> {
  return unavailable('dispatchEmailVerification')
}

export async function requestAttachEmailLink(..._args: unknown[]): Promise<never> {
  return unavailable('requestAttachEmailLink')
}

export async function requestMagicLink(..._args: unknown[]): Promise<never> {
  return unavailable('requestMagicLink')
}

export async function requestOtp(..._args: unknown[]): Promise<never> {
  return unavailable('requestOtp')
}

export async function signInWithGoogle(..._args: unknown[]): Promise<never> {
  return unavailable('signInWithGoogle')
}

export async function verifyAttachEmailToken(..._args: unknown[]): Promise<never> {
  return unavailable('verifyAttachEmailToken')
}

export async function verifyMagicLink(..._args: unknown[]): Promise<never> {
  return unavailable('verifyMagicLink')
}

export async function verifyOtp(..._args: unknown[]): Promise<never> {
  return unavailable('verifyOtp')
}

export async function verifyPhoneChallenge(..._args: unknown[]): Promise<never> {
  return unavailable('verifyPhoneChallenge')
}

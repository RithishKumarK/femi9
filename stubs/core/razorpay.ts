/**
 * Payments. Every function here moves money or validates that money moved.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from './_unavailable'

export class GatewayNotExecutedError extends StubDomainError {}

export function isConfigured(): boolean {
  return false
}

export function webhookConfigured(): boolean {
  return false
}

export function publicKeyId(): string {
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? ''
}

export async function createOrder(..._args: unknown[]): Promise<never> {
  return unavailable('createOrder')
}

export async function refundPayment(..._args: unknown[]): Promise<never> {
  return unavailable('refundPayment')
}

export async function verifyPaymentSignature(..._args: unknown[]): Promise<never> {
  return unavailable('verifyPaymentSignature')
}

export async function verifySubscriptionSignature(..._args: unknown[]): Promise<never> {
  return unavailable('verifySubscriptionSignature')
}

export async function verifyWebhookSignature(..._args: unknown[]): Promise<never> {
  return unavailable('verifyWebhookSignature')
}

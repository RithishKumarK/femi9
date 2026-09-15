/**
 * WhatsApp Cloud API: sign-in OTP and order status.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export const WHATSAPP_TEMPLATES = {
  otp: 'femi9_signin_otp',
  orderPlaced: 'femi9_order_placed',
  orderShipped: 'femi9_order_shipped',
  orderDelivered: 'femi9_order_delivered',
} as const

export function whatsappConfigured(): boolean {
  return false
}

/** E.164 without the plus, which is the shape the Cloud API wants. */
export function toWhatsappNumber(input: string): string {
  const digits = input.replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

export function templateParam(value: string | number): { type: 'text'; text: string } {
  return { type: 'text', text: String(value) }
}

export async function sendWhatsappTemplate(..._args: unknown[]): Promise<never> {
  return unavailable('sendWhatsappTemplate')
}

export async function sendWhatsappTemplateOrThrow(..._args: unknown[]): Promise<never> {
  return unavailable('sendWhatsappTemplateOrThrow')
}

/**
 * The money path: placing, paying for and reconciling an order.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export interface CheckoutCustomer { name: string; email?: string; phone: string }

export class EmptyCartError extends StubDomainError {}
export class InvalidCouponError extends StubDomainError {}
export class OrderNotFoundError extends StubDomainError {}
export class OrderNotPayableError extends StubDomainError {}
export class OutOfStockError extends StubDomainError {}
export class PaymentAmountMismatchError extends StubDomainError {}
export class PaymentIntentMissingError extends StubDomainError {}
export class ZeroTotalOrderError extends StubDomainError {}

export async function getOrderByNo(..._args: unknown[]): Promise<never> {
  return unavailable('getOrderByNo')
}

export async function markOrderPaid(..._args: unknown[]): Promise<never> {
  return unavailable('markOrderPaid')
}

export async function orderNoForRazorpayOrderId(..._args: unknown[]): Promise<never> {
  return unavailable('orderNoForRazorpayOrderId')
}

export async function pendingPaymentIntent(..._args: unknown[]): Promise<never> {
  return unavailable('pendingPaymentIntent')
}

export async function placeOrder(..._args: unknown[]): Promise<never> {
  return unavailable('placeOrder')
}

export async function reconcilePendingOrders(..._args: unknown[]): Promise<never> {
  return unavailable('reconcilePendingOrders')
}

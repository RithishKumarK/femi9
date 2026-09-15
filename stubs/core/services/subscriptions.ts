/**
 * Razorpay mandates. Every call here schedules or stops a real debit.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export class CadenceNotFoundError extends StubDomainError {}
export class VariantNotFoundError extends StubDomainError {}

export async function authorizationFor(..._args: unknown[]): Promise<never> {
  return unavailable('authorizationFor')
}

export async function cancel(..._args: unknown[]): Promise<never> {
  return unavailable('cancel')
}

export async function confirmMandate(..._args: unknown[]): Promise<never> {
  return unavailable('confirmMandate')
}

export async function createSubscription(..._args: unknown[]): Promise<never> {
  return unavailable('createSubscription')
}

export async function generateDueOrders(..._args: unknown[]): Promise<never> {
  return unavailable('generateDueOrders')
}

export async function listForUser(..._args: unknown[]): Promise<never> {
  return unavailable('listForUser')
}

export async function pause(..._args: unknown[]): Promise<never> {
  return unavailable('pause')
}

export async function recordSubscriptionCharge(..._args: unknown[]): Promise<never> {
  return unavailable('recordSubscriptionCharge')
}

export async function resume(..._args: unknown[]): Promise<never> {
  return unavailable('resume')
}

export async function resumeDueSkips(..._args: unknown[]): Promise<never> {
  return unavailable('resumeDueSkips')
}

export async function skipNext(..._args: unknown[]): Promise<never> {
  return unavailable('skipNext')
}

export async function syncGatewayStatus(..._args: unknown[]): Promise<never> {
  return unavailable('syncGatewayStatus')
}

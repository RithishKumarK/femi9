/**
 * Console order actions. The console itself lives in apps/admin.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../../_unavailable'

export class NotRefundableError extends StubDomainError {}

export async function getOrder(..._args: unknown[]): Promise<never> {
  return unavailable('getOrder')
}

export async function recordGatewayRefund(..._args: unknown[]): Promise<never> {
  return unavailable('recordGatewayRefund')
}

export async function refundOrder(..._args: unknown[]): Promise<never> {
  return unavailable('refundOrder')
}

export async function updateOrderStatus(..._args: unknown[]): Promise<never> {
  return unavailable('updateOrderStatus')
}

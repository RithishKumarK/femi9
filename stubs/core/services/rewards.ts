/**
 * Points balance and redemption.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export interface RewardOptionView { id: string; label: string; points: number; valuePaise: number; hasAmazonCode: boolean; amazonCode?: string | null }

export class InsufficientPointsError extends StubDomainError {}
export class RewardOptionNotFoundError extends StubDomainError {}

export async function listRewardOptions(..._args: unknown[]): Promise<never> {
  return unavailable('listRewardOptions')
}

export async function redeem(..._args: unknown[]): Promise<never> {
  return unavailable('redeem')
}

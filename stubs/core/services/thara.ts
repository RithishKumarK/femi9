/**
 * Thara — the referral / community programme.
 *
 * Every route behind this is feature-flagged and 404s unless `THARA_ENABLED` is
 * exactly "true", so in a default preview none of it is reachable. The module
 * still has to exist and export the full surface, because the routes import it
 * at module scope and the flag is only checked inside the handler.
 *
 * The constants below are the programme's published rates and are kept real;
 * everything that reads or writes a membership throws.
 */

import { unavailable, StubDomainError } from '../_unavailable'

/** Commission paid to the referrer, as a percentage of the qualifying order. */
export const THARA_COMMISSION_PCT = 10
/** Points accrued to the referee, as a percentage of the order. */
export const THARA_POINTS_PCT = 5
/** An order below this does not qualify. Paise, because the gateway speaks paise. */
export const THARA_QUALIFYING_MIN_PAISE = 49_900
/** How long a issued voucher stays claimable. */
export const THARA_VOUCHER_CLAIM_DAYS = 30
/** Points-to-voucher-value multiplier at claim time. */
export const THARA_VOUCHER_MULTIPLIER = 2

/** Order-count thresholds and the discount each unlocks. */
export interface TharaDiscountSlabs {
  minOrders: number
  discountPct: number
}

export const TharaDiscountSlabs: TharaDiscountSlabs[] = [
  { minOrders: 0, discountPct: 0 },
  { minOrders: 3, discountPct: 5 },
  { minOrders: 6, discountPct: 10 },
  { minOrders: 12, discountPct: 15 },
]

export class TharaNotFoundError extends StubDomainError {}
export class TharaDeactivatedError extends StubDomainError {}
export class TharaInviteBadEmailError extends StubDomainError {}
export class TharaInviteNotEligibleError extends StubDomainError {}
export class TharaInviteSelfError extends StubDomainError {}
export class TharaInviteSuppressedError extends StubDomainError {}
export class TharaVoucherNotClaimableError extends StubDomainError {}

/** Pure, and kept real: which slab a member's order count falls in. */
export function computeTharaDiscount(orderCount: number): number {
  let pct = 0
  for (const slab of TharaDiscountSlabs) {
    if (orderCount >= slab.minOrders) pct = slab.discountPct
  }
  return pct
}

export async function accrueTharaCommission(..._args: unknown[]): Promise<never> { return unavailable('accrueTharaCommission') }
export async function accrueTharaPoints(..._args: unknown[]): Promise<never> { return unavailable('accrueTharaPoints') }
export async function activateAndLockIfEligible(..._args: unknown[]): Promise<never> { return unavailable('activateAndLockIfEligible') }
export async function applyTharaCredit(..._args: unknown[]): Promise<never> { return unavailable('applyTharaCredit') }
export async function attributeReferralIfPresent(..._args: unknown[]): Promise<never> { return unavailable('attributeReferralIfPresent') }
export async function claimVoucher(..._args: unknown[]): Promise<never> { return unavailable('claimVoucher') }
export async function closeCycle(..._args: unknown[]): Promise<never> { return unavailable('closeCycle') }
export async function currentOpenCycle(..._args: unknown[]): Promise<never> { return unavailable('currentOpenCycle') }
export async function enrollUser(..._args: unknown[]): Promise<never> { return unavailable('enrollUser') }
export async function expireStaleVouchers(..._args: unknown[]): Promise<never> { return unavailable('expireStaleVouchers') }
export async function getMembership(..._args: unknown[]): Promise<never> { return unavailable('getMembership') }
export async function getTharaCreditBalance(..._args: unknown[]): Promise<never> { return unavailable('getTharaCreditBalance') }
export async function getUnlockProgress(..._args: unknown[]): Promise<never> { return unavailable('getUnlockProgress') }
export async function getUserCyclePoints(..._args: unknown[]): Promise<never> { return unavailable('getUserCyclePoints') }
export async function listMemberships(..._args: unknown[]): Promise<never> { return unavailable('listMemberships') }
export async function optOutUser(..._args: unknown[]): Promise<never> { return unavailable('optOutUser') }
export async function reverseTharaCreditForRefund(..._args: unknown[]): Promise<never> { return unavailable('reverseTharaCreditForRefund') }
export async function reverseTharaPointsForRefund(..._args: unknown[]): Promise<never> { return unavailable('reverseTharaPointsForRefund') }
export async function sendTharaInvite(..._args: unknown[]): Promise<never> { return unavailable('sendTharaInvite') }
export async function suppressEmail(..._args: unknown[]): Promise<never> { return unavailable('suppressEmail') }
export async function suspendMembership(..._args: unknown[]): Promise<never> { return unavailable('suspendMembership') }
export async function syncTharaActivation(..._args: unknown[]): Promise<never> { return unavailable('syncTharaActivation') }
export async function unsuspendMembership(..._args: unknown[]): Promise<never> { return unavailable('unsuspendMembership') }

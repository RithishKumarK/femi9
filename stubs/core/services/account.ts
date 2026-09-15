/**
 * The signed-in customer surface.
 *
 * Every read here is a real customer's real row, so there is nothing honest to
 * fake: the functions throw. What this module DOES carry is the full set of
 * view-model types, because /account, /dashboard, /welcome and the member
 * sheets all import them as types and would not compile without them.
 *
 * The types are reconstructed from the fields those components actually read,
 * so they are as accurate as the consumers are — but they are inferred, not
 * copied from the real package. Treat a mismatch as this file's fault.
 */

import { unavailable, StubDomainError } from '../_unavailable'

/** The three things a customer must give us before checkout works. */
export type ProfileField = 'name' | 'email' | 'phone'

export interface AccountUser {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  emailVerified?: boolean
  phoneVerified?: boolean
  createdAt?: string
}

export interface AccountAddress {
  id: string
  label: string | null
  name: string
  line: string
  city: string
  state: string
  pincode: string
  phone: string | null
  isDefault: boolean
}

export type OrderStatusKey = 'pending' | 'processing' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'

export interface AccountOrder {
  id: string
  orderNo: string
  date: string
  status: string
  statusKey: OrderStatusKey
  total: number
  items: number
  href: string
}

export type SubStatus =
  | 'pending_mandate'
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'halted'

export interface AccountSubscription {
  id: string
  product: string
  qty: number
  frequency: string
  nextDelivery: string | null
  chargeAmount: number
  saved: number
  status: SubStatus
  /** True while the bank has not yet approved the mandate: nothing is debited. */
  needsMandate: boolean
}

export interface AccountCoupon {
  id: string
  code: string
  label: string
  expires: string | null
  used: boolean
  couponType?: string
  couponValue?: number
}

export interface EarnRates {
  pointsPerRupee: number
  reviewPoints: number
  firstOrderBonusPoints: number
  firstOrderBonusEarned: boolean
}

export interface SpendTrend {
  labels: string[]
  values: number[]
  hasData: boolean
}

export interface ActivityItem {
  id: string
  date: string
  label: string
  /** Points moved. Negative on a redemption. */
  pts: number
}

export interface ProfileStatus {
  user: AccountUser
  missing: ProfileField[]
  complete: boolean
}

export class ProfileIncompleteError extends StubDomainError {}

/** Pure, and kept real: the rule is "all three present and non-blank". */
export function missingProfileFields(user: Partial<AccountUser> | null | undefined): ProfileField[] {
  if (!user) return ['name', 'email', 'phone']
  const missing: ProfileField[] = []
  if (!user.name?.trim()) missing.push('name')
  if (!user.email?.trim()) missing.push('email')
  if (!user.phone?.trim()) missing.push('phone')
  return missing
}

export function isProfileComplete(user: Partial<AccountUser> | null | undefined): boolean {
  return missingProfileFields(user).length === 0
}

/** Row -> view model. Shape-only, so it works without Prisma. */
export function toAccountUser(row: Record<string, unknown> | null): AccountUser | null {
  if (!row) return null
  return {
    id: String(row.id ?? ''),
    name: (row.name as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    emailVerified: Boolean(row.emailVerified),
    phoneVerified: Boolean(row.phoneVerified),
  }
}

export async function getAccountData(..._args: unknown[]): Promise<never> {
  return unavailable('getAccountData')
}

export async function getProfileStatus(..._args: unknown[]): Promise<never> {
  return unavailable('getProfileStatus')
}

export async function createAddress(..._args: unknown[]): Promise<never> {
  return unavailable('createAddress')
}

export async function updateAddress(..._args: unknown[]): Promise<never> {
  return unavailable('updateAddress')
}

export async function deleteAddress(..._args: unknown[]): Promise<never> {
  return unavailable('deleteAddress')
}

export async function updateProfile(..._args: unknown[]): Promise<never> {
  return unavailable('updateProfile')
}

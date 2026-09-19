import 'server-only'
import type { TharaMembership, TharaStatus, Prisma, User } from '@prisma/client'
import { dbFor, type Brand, type PrismaClient } from '@femi9/db'
import { PAID_ORDER_STATUSES } from '../order-status'
import { generateReferralCode } from '../thara/codes'
import { verifyTharaRefCookie } from '../thara/cookies'
import { isTharaEnabled } from '../thara/feature'

/**
 * Thara Model service.
 *
 * Sub-project A covers enrolment lifecycle and attribution. Later sub-projects
 * append to this file (activate, suspend, and further helpers used by the
 * checkout/payment paths and admin routes).
 *
 * State machine:
 *   (none) -> purchase_pending -> active -> suspended -> active
 *                                       \-> deactivated (terminal for a user)
 */

export class TharaDeactivatedError extends Error {
  constructor() {
    super('This account previously opted out of the Thara program.')
    this.name = 'TharaDeactivatedError'
  }
}

const CODE_MAX_TRIES = 5

async function issueUniqueCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < CODE_MAX_TRIES; attempt++) {
    const candidate = generateReferralCode()
    const clash = await tx.tharaMembership.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    })
    if (!clash) return candidate
  }
  throw new Error('Could not issue a unique referral code after 5 tries')
}

export async function enrollUser(brand: Brand, 
  userId: string,
  termsVersion: string,
): Promise<{ id: string; status: TharaStatus; referralCode: string }> {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tharaMembership.findUnique({ where: { userId } })
    if (existing) {
      if (existing.status === 'deactivated') throw new TharaDeactivatedError()
      // A member who was already stuck in purchase_pending with a qualifying
      // order behind her gets promoted here too, so re-opening the dashboard is
      // enough to repair her — she does not have to buy a THIRD time.
      const promoted = await activateFromPastOrders(tx, userId)
      return {
        id: existing.id,
        status: promoted ? ('active' as TharaStatus) : existing.status,
        referralCode: existing.referralCode,
      }
    }
    const referralCode = await issueUniqueCode(tx)
    const created = await tx.tharaMembership.create({
      data: {
        userId,
        status: 'purchase_pending',
        referralCode,
        termsAcceptedAt: new Date(),
        termsVersion,
      },
    })
    // The normal shopper buys FIRST and discovers the programme afterwards.
    // Activation used to fire only inside markOrderPaid, so those orders were
    // already in the past by the time the membership row existed and nothing
    // ever promoted her — she stayed "purchase pending" no matter how much she
    // had spent. Qualify off her order history at the moment she joins.
    const promoted = await activateFromPastOrders(tx, userId)
    return {
      id: created.id,
      status: promoted ? ('active' as TharaStatus) : created.status,
      referralCode: created.referralCode,
    }
  })
}

export async function optOutUser(brand: Brand, userId: string): Promise<void> {
  const prisma = dbFor(brand)
  await prisma.tharaMembership.update({
    where: { userId },
    data: { status: 'deactivated', deactivatedAt: new Date() },
  })
}

export async function getMembership(brand: Brand, userId: string): Promise<TharaMembership | null> {
  const prisma = dbFor(brand)
  return prisma.tharaMembership.findUnique({ where: { userId } })
}

type AttributionReason =
  | 'no-cookie'
  | 'bad-cookie'
  | 'referrer-not-found'
  | 'referrer-not-eligible'
  | 'self-referral'
  | 'dup-email'
  | 'dup-phone'
  | 'insufficient-identity'
  | 'already-attributed'

export interface AttributionInput {
  cookieToken: string | null
  ip: string | null
  ua: string | null
}

/**
 * Called from every sign-in path after a User is upserted. Silently no-ops
 * for any reject reason so sign-in never fails because of attribution.
 */
export async function attributeReferralIfPresent(brand: Brand, 
  user: User,
  input: AttributionInput,
): Promise<{ attributed: boolean; reason?: AttributionReason }> {
  const prisma = dbFor(brand)
  if (!input.cookieToken) return { attributed: false, reason: 'no-cookie' }
  const claim = await verifyTharaRefCookie(input.cookieToken)
  if (!claim) return { attributed: false, reason: 'bad-cookie' }

  const referrer = await prisma.tharaMembership.findUnique({
    where: { id: claim.referrerMembershipId },
    include: { user: { select: { id: true, email: true, phone: true } } },
  })
  if (!referrer) return { attributed: false, reason: 'referrer-not-found' }
  if (referrer.status === 'suspended' || referrer.status === 'deactivated') {
    return { attributed: false, reason: 'referrer-not-eligible' }
  }

  if (referrer.user.id === user.id) return { attributed: false, reason: 'self-referral' }

  // Duplicate-identity guards. Each one is only MEANINGFUL when both operands
  // are present — a null on either side means the comparison did not run, not
  // that it cleared. That distinction is the whole guard: a member who enrolled
  // by phone OTP has email null, so `user.email &&` short-circuited for every
  // email-path signup, and vice versa. Signing up a second time through the
  // OTHER channel produced a row sharing no non-null field, attribution
  // succeeded, and the referrer earned 10% store credit plus reward points on
  // her own purchase.
  const emailComparable = Boolean(user.email && referrer.user.email)
  const phoneComparable = Boolean(user.phone && referrer.user.phone)

  if (emailComparable && user.email!.toLowerCase() === referrer.user.email!.toLowerCase()) {
    return { attributed: false, reason: 'dup-email' }
  }
  if (phoneComparable && user.phone === referrer.user.phone) {
    return { attributed: false, reason: 'dup-phone' }
  }
  // Neither comparison could run, so we cannot tell these two apart. Refuse
  // rather than pay a commission we cannot prove is not self-dealing.
  if (!emailComparable && !phoneComparable) {
    return { attributed: false, reason: 'insufficient-identity' }
  }

  try {
    await prisma.tharaReferral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: user.id,
        invitedByLink: true,
        ipAtSignup: input.ip ?? undefined,
        uaAtSignup: input.ua ?? undefined,
      },
    })
    return { attributed: true }
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return { attributed: false, reason: 'already-attributed' }
    }
    throw e
  }
}

export const THARA_QUALIFYING_MIN_PAISE = 300_000 // ₹3,000

/**
 * Called INSIDE the markOrderPaid transaction, so any failure rolls the whole
 * order-paid commit back. Two independent side-effects:
 *  1) If the buyer has a purchase_pending membership and this order is >= ₹3,000,
 *     promote to active and stamp the qualifying order.
 *  2) If the buyer has an incoming, unlocked referral and this order is >= ₹3,000,
 *     set lockedAt = now — permanent from that instant.
 */
export async function activateAndLockIfEligible(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, subtotal: true },
  })
  if (!order || !order.userId) return
  if (order.subtotal < THARA_QUALIFYING_MIN_PAISE) return

  await tx.tharaMembership.updateMany({
    where: { userId: order.userId, status: 'purchase_pending' },
    data: { status: 'active', activatedAt: new Date(), qualifyingOrderId: order.id },
  })

  await tx.tharaReferral.updateMany({
    where: { referredUserId: order.userId, lockedAt: null },
    data: { lockedAt: new Date() },
  })
}

/**
 * The mirror image of activateAndLockIfEligible: instead of "an order was just
 * paid, is there a membership to promote?", it asks "there is a membership
 * sitting in purchase_pending, is there already a paid order behind it?".
 *
 * Needed because activation used to exist ONLY on the payment path. A shopper
 * who bought before she enrolled — the ordinary case, since the programme is
 * discovered from the account page after a purchase — could never be promoted
 * by any amount of past spending, and the dashboard told her to go and buy
 * again. Runs on enrolment and on every dashboard read, so it self-heals
 * members who are already stuck.
 *
 * Returns true when it promoted the membership.
 */
export async function activateFromPastOrders(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const membership = await tx.tharaMembership.findUnique({
    where: { userId },
    select: { id: true, status: true },
  })
  if (!membership || membership.status !== 'purchase_pending') return false

  // Oldest qualifying order wins, so the stamped qualifyingOrderId is the order
  // that genuinely earned the unlock. `tharaQualifyingFor: { is: null }` keeps
  // us off an order already stamped on some membership — qualifyingOrderId is
  // @unique and the write would otherwise blow up on P2002.
  const qualifying = await tx.order.findFirst({
    where: {
      userId,
      status: { in: PAID_ORDER_STATUSES },
      subtotal: { gte: THARA_QUALIFYING_MIN_PAISE },
      tharaQualifyingFor: { is: null },
    },
    orderBy: { placedAt: 'asc' },
    select: { id: true },
  })
  if (!qualifying) return false

  // Compare-and-set on the status so a concurrent markOrderPaid activation
  // cannot be double-applied; whoever loses the race writes nothing.
  const res = await tx.tharaMembership.updateMany({
    where: { id: membership.id, status: 'purchase_pending' },
    data: { status: 'active', activatedAt: new Date(), qualifyingOrderId: qualifying.id },
  })
  return res.count > 0
}

/**
 * Route-level wrapper for the above. Safe to call on every dashboard read: it
 * is a no-op for anyone who is not an unpromoted member, and it never throws
 * into the response — a repair that fails should not blank the dashboard.
 */
export async function syncTharaActivation(brand: Brand, userId: string): Promise<void> {
  const prisma = dbFor(brand)
  if (!isTharaEnabled()) return
  try {
    await prisma.$transaction((tx) => activateFromPastOrders(tx, userId))
  } catch {
    // Best-effort self-heal. The membership stays as it is and the next read
    // tries again.
  }
}

/**
 * What the member still has to do to unlock earning, in numbers the UI can
 * render directly. The rule is ONE order of ≥ ₹3,000 — several smaller orders
 * never add up to it, which is the single most misread part of the programme,
 * so the dashboard shows the BIGGEST single paid order rather than a total.
 */
export interface TharaUnlockProgress {
  requiredPaise: number
  /** Largest single paid order this user has placed. 0 when she has none. */
  bestOrderPaise: number
  bestOrderNo: string | null
  paidOrderCount: number
  qualified: boolean
  /** How much bigger ONE order has to be. 0 once qualified. */
  shortfallPaise: number
}

export async function getUnlockProgress(brand: Brand, userId: string): Promise<TharaUnlockProgress> {
  const prisma = dbFor(brand)
  const [best, paidOrderCount] = await Promise.all([
    prisma.order.findFirst({
      where: { userId, status: { in: PAID_ORDER_STATUSES } },
      orderBy: { subtotal: 'desc' },
      select: { subtotal: true, orderNo: true },
    }),
    prisma.order.count({ where: { userId, status: { in: PAID_ORDER_STATUSES } } }),
  ])
  const bestOrderPaise = best?.subtotal ?? 0
  return {
    requiredPaise: THARA_QUALIFYING_MIN_PAISE,
    bestOrderPaise,
    bestOrderNo: best?.orderNo ?? null,
    paidOrderCount,
    qualified: bestOrderPaise >= THARA_QUALIFYING_MIN_PAISE,
    shortfallPaise: Math.max(0, THARA_QUALIFYING_MIN_PAISE - bestOrderPaise),
  }
}

export class TharaNotFoundError extends Error {
  constructor() {
    super('Thara membership not found.')
    this.name = 'TharaNotFoundError'
  }
}

export async function suspendMembership(brand: Brand, 
  id: string,
  reason: string,
): Promise<TharaMembership> {
  const prisma = dbFor(brand)
  const existing = await prisma.tharaMembership.findUnique({ where: { id } })
  if (!existing) throw new TharaNotFoundError()
  if (existing.status === 'suspended') return existing
  return prisma.tharaMembership.update({
    where: { id },
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: reason,
      statusBeforeSuspend: existing.status,
    },
  })
}

export async function unsuspendMembership(brand: Brand, id: string): Promise<TharaMembership> {
  const prisma = dbFor(brand)
  const existing = await prisma.tharaMembership.findUnique({ where: { id } })
  if (!existing) throw new TharaNotFoundError()
  if (existing.status !== 'suspended') return existing
  return prisma.tharaMembership.update({
    where: { id },
    data: {
      status: existing.statusBeforeSuspend ?? 'purchase_pending',
      suspendedAt: null,
      suspendedReason: null,
      statusBeforeSuspend: null,
    },
  })
}

export async function getMembershipById(brand: Brand, id: string): Promise<TharaMembership | null> {
  const prisma = dbFor(brand)
  return prisma.tharaMembership.findUnique({ where: { id } })
}

// ─────────────────────── Sub-project D: reward points ─────────────────────

import { selectVoucherIssuer, ManualIssuer, AmazonIncentivesNotConfiguredError, AmazonIncentivesNotImplementedError, type VoucherIssuer } from '../thara/voucher-issuer'
import type { TharaCycle, TharaVoucher } from '@prisma/client'

export const THARA_POINTS_PCT = 1 // 1% of downline subtotal → points
export const THARA_VOUCHER_MULTIPLIER = 3 // points × 3 = ₹ voucher value
export const THARA_VOUCHER_CLAIM_DAYS = 30

export const TharaPointsReason = {
  REFERRAL_POINTS: 'referral-points',
  REFUND_REVERSAL: 'refund-reversal',
} as const

/**
 * Return the currently open cycle, creating one if none exists. The
 * default cycle boundaries are the calendar quarter that contains `now`
 * — Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec.
 */
export async function currentOpenCycle(brand: Brand, 
  now: Date = new Date(),
): Promise<TharaCycle> {
  const prisma = dbFor(brand)
  const open = await prisma.tharaCycle.findFirst({
    where: { status: 'open' },
    orderBy: { startDate: 'desc' },
  })
  if (open) return open

  // Emit a calendar quarter containing `now`.
  const y = now.getUTCFullYear()
  const q = Math.floor(now.getUTCMonth() / 3) // 0..3
  const startMonth = q * 3
  const startDate = new Date(Date.UTC(y, startMonth, 1, 0, 0, 0))
  const endDate = new Date(Date.UTC(y, startMonth + 3, 0, 23, 59, 59)) // last day of month
  return prisma.tharaCycle.create({
    data: { startDate, endDate, status: 'open' },
  })
}

/**
 * Called inside markOrderPaid. On a paid downline order for an eligible
 * (locked + active) referrer, add 1% of subtotal (as an integer point count)
 * to the referrer's ledger row in the current open cycle.
 */
export async function accrueTharaPoints(brand: Brand, 
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const prisma = dbFor(brand)
  if (!isTharaEnabled()) return

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, subtotal: true },
  })
  if (!order || !order.userId) return

  const referral = await tx.tharaReferral.findUnique({
    where: { referredUserId: order.userId },
    select: {
      lockedAt: true,
      referrer: { select: { userId: true, status: true } },
    },
  })
  if (!referral || !referral.lockedAt) return
  if (referral.referrer.status !== 'active') return

  const points = Math.floor((order.subtotal * THARA_POINTS_PCT) / 100 / 100) // paise → ₹, then 1%
  if (points <= 0) return

  // Cycle lookup goes on prisma (not tx) so an already-open cycle survives
  // a rollback of the outer order-paid transaction. Creating a cycle from
  // inside a transaction is safe too, but reading it outside is quicker.
  const cycle = await currentOpenCycle(brand)

  await tx.tharaRewardPointsLedger.create({
    data: {
      userId: referral.referrer.userId,
      cycleId: cycle.id,
      delta: points,
      reason: TharaPointsReason.REFERRAL_POINTS,
      sourceOrderId: order.id,
    },
  })
}

/** Called inside refundOrder. Reverses every points row for this order. */
export async function reverseTharaPointsForRefund(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const rows = await tx.tharaRewardPointsLedger.findMany({
    where: { sourceOrderId: orderId, reason: TharaPointsReason.REFERRAL_POINTS },
  })
  for (const row of rows) {
    await tx.tharaRewardPointsLedger.create({
      data: {
        userId: row.userId,
        cycleId: row.cycleId,
        delta: -row.delta,
        reason: TharaPointsReason.REFUND_REVERSAL,
        sourceOrderId: orderId,
      },
    })
  }
}

/** Get a user's points balance in a given cycle (or the current open cycle). */
export async function getUserCyclePoints(brand: Brand, 
  userId: string,
  cycleId: string,
): Promise<number> {
  const prisma = dbFor(brand)
  const agg = await prisma.tharaRewardPointsLedger.aggregate({
    where: { userId, cycleId },
    _sum: { delta: true },
  })
  return Math.max(0, agg._sum.delta ?? 0)
}

/**
 * Close the given cycle: sum points per user, issue a TharaVoucher for each
 * user with >0 points, ask the issuer for an Amazon code (falling back to
 * manual issuance if the issuer defers or is not yet onboarded), stamp the
 * cycle closed. Idempotent — a second call on the same cycle is a no-op.
 */
export async function closeCycle(brand: Brand, 
  cycleId: string,
  issuer: VoucherIssuer = selectVoucherIssuer(),
): Promise<{ vouchersIssued: number }> {
  const prisma = dbFor(brand)
  const cycle = await prisma.tharaCycle.findUnique({ where: { id: cycleId } })
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`)
  if (cycle.status === 'closed') return { vouchersIssued: 0 }

  const grouped = await prisma.tharaRewardPointsLedger.groupBy({
    by: ['userId'],
    where: { cycleId },
    _sum: { delta: true },
  })
  const eligible = grouped
    .map((g) => ({ userId: g.userId, points: g._sum.delta ?? 0 }))
    .filter((g) => g.points > 0)

  const claimDeadlineFor = (issuedAt: Date) => {
    const d = new Date(issuedAt)
    d.setUTCDate(d.getUTCDate() + THARA_VOUCHER_CLAIM_DAYS)
    return d
  }

  let count = 0
  for (const row of eligible) {
    // Idempotent per-user via the (userId, cycleId) unique index.
    const existing = await prisma.tharaVoucher.findUnique({
      where: { userId_cycleId: { userId: row.userId, cycleId } },
    })
    if (existing) continue

    const valuePaise = row.points * THARA_VOUCHER_MULTIPLIER * 100 // points × 3 = ₹, ×100 = paise
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { email: true, name: true },
    })

    let amazonCode: string | null = null
    try {
      const result = await issuer.issue({
        valuePaise,
        userEmail: user?.email ?? null,
        userName: user?.name ?? null,
        externalReference: `cycle:${cycleId}:${row.userId}`,
      })
      amazonCode = result.amazonCode
    } catch (e) {
      // Real Amazon integration not ready — fall back to manual issuance.
      if (e instanceof AmazonIncentivesNotConfiguredError || e instanceof AmazonIncentivesNotImplementedError) {
        const fallback = await new ManualIssuer().issue({
          valuePaise,
          userEmail: user?.email ?? null,
          userName: user?.name ?? null,
          externalReference: `cycle:${cycleId}:${row.userId}`,
        })
        amazonCode = fallback.amazonCode
      } else {
        throw e
      }
    }

    const issuedAt = new Date()
    await prisma.tharaVoucher.create({
      data: {
        userId: row.userId,
        cycleId,
        points: row.points,
        valuePaise,
        amazonCode,
        status: 'available',
        issuedAt,
        claimDeadline: claimDeadlineFor(issuedAt),
      },
    })
    count += 1
  }

  await prisma.tharaCycle.update({
    where: { id: cycleId },
    data: { status: 'closed', closedAt: new Date() },
  })
  return { vouchersIssued: count }
}

/** Expire vouchers whose claimDeadline has passed. Returns the count expired. */
export async function expireStaleVouchers(brand: Brand, now: Date = new Date()): Promise<number> {
  const prisma = dbFor(brand)
  const res = await prisma.tharaVoucher.updateMany({
    where: { status: 'available', claimDeadline: { lt: now } },
    data: { status: 'expired' },
  })
  return res.count
}

export class TharaVoucherNotClaimableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'TharaVoucherNotClaimableError'
  }
}

/** Mark a voucher claimed. Refuses non-available vouchers and mismatched users. */
export async function claimVoucher(brand: Brand, 
  voucherId: string,
  userId: string,
): Promise<TharaVoucher> {
  const prisma = dbFor(brand)
  const v = await prisma.tharaVoucher.findUnique({ where: { id: voucherId } })
  if (!v || v.userId !== userId) {
    throw new TharaVoucherNotClaimableError('Voucher not found.')
  }
  if (v.status === 'claimed') return v
  if (v.status !== 'available') {
    throw new TharaVoucherNotClaimableError(`Voucher is ${v.status}.`)
  }
  if (v.claimDeadline < new Date()) {
    // Race: about to expire. Treat as expired.
    throw new TharaVoucherNotClaimableError('Voucher has expired.')
  }
  return prisma.tharaVoucher.update({
    where: { id: voucherId },
    data: { status: 'claimed', claimedAt: new Date() },
  })
}

// ─────────────────────── Sub-project E: invite emails ─────────────────────

import { renderInviteEmail, sendTharaInviteEmail } from '../thara/invite'

export class TharaInviteNotEligibleError extends Error {
  constructor() {
    super('Only enrolled Thara members can send invites.')
    this.name = 'TharaInviteNotEligibleError'
  }
}
export class TharaInviteBadEmailError extends Error {
  constructor() {
    super('That does not look like a valid email address.')
    this.name = 'TharaInviteBadEmailError'
  }
}
export class TharaInviteSelfError extends Error {
  constructor() {
    super("You can't invite yourself.")
    this.name = 'TharaInviteSelfError'
  }
}
export class TharaInviteSuppressedError extends Error {
  constructor() {
    super("That address opted out of our emails. Share your link some other way.")
    this.name = 'TharaInviteSuppressedError'
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Send a referral invite to a friend's email. Requires the sender to be a
 * Thara member (either purchase_pending or active), refuses suppressed
 * addresses, refuses self-invites. Rate limiting lives at the route layer.
 */
export async function sendTharaInvite(brand: Brand, 
  referrerUserId: string,
  toEmail: string,
): Promise<{ mock: boolean }> {
  const prisma = dbFor(brand)
  const to = toEmail.trim().toLowerCase()
  if (!EMAIL_RE.test(to)) throw new TharaInviteBadEmailError()

  const membership = await prisma.tharaMembership.findUnique({
    where: { userId: referrerUserId },
    include: { user: { select: { name: true, email: true } } },
  })
  if (!membership) throw new TharaInviteNotEligibleError()
  if (membership.status !== 'active' && membership.status !== 'purchase_pending') {
    throw new TharaInviteNotEligibleError()
  }
  if (membership.user.email && membership.user.email.toLowerCase() === to) {
    throw new TharaInviteSelfError()
  }

  const suppressed = await prisma.tharaSuppressedEmail.findUnique({ where: { email: to } })
  if (suppressed) throw new TharaInviteSuppressedError()

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const referralUrl = base ? `${base}/r/${membership.referralCode}` : `/r/${membership.referralCode}`
  const { subject, html, text } = renderInviteEmail({
    referrerName: membership.user.name ?? null,
    referralCode: membership.referralCode,
    referralUrl,
  })
  return sendTharaInviteEmail({ to, subject, html, text })
}

export async function suppressEmail(brand: Brand, email: string, reason: 'hard_bounce' | 'complaint' | 'manual'): Promise<void> {
  const prisma = dbFor(brand)
  const key = email.trim().toLowerCase()
  if (!EMAIL_RE.test(key)) return
  await prisma.tharaSuppressedEmail.upsert({
    where: { email: key },
    update: { reason },
    create: { email: key, reason },
  })
}

// ─────────────────────── Sub-project C: wallet credit ──────────────────────

export const TharaCreditReason = {
  REFERRAL_COMMISSION: 'referral-commission',
  CHECKOUT_SPEND: 'checkout-spend',
  REFUND_REVERSAL: 'refund-reversal',
} as const

export const THARA_COMMISSION_PCT = 10 // 10% of downline paid subtotal

/**
 * Called inside markOrderPaid. When the paid order was placed by a referred
 * user with a permanent (locked) referral to an active Thara member, credit
 * 10% of the subtotal to the referrer's Femi9 store-credit ledger.
 */
export async function accrueTharaCommission(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  if (!isTharaEnabled()) return

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, subtotal: true },
  })
  if (!order || !order.userId) return

  const referral = await tx.tharaReferral.findUnique({
    where: { referredUserId: order.userId },
    select: {
      lockedAt: true,
      referrer: { select: { userId: true, status: true } },
    },
  })
  if (!referral || !referral.lockedAt) return
  if (referral.referrer.status !== 'active') return

  const delta = Math.floor((order.subtotal * THARA_COMMISSION_PCT) / 100)
  if (delta <= 0) return

  const prior = await tx.tharaCreditLedger.aggregate({
    where: { userId: referral.referrer.userId },
    _sum: { delta: true },
  })
  const balanceAfter = (prior._sum.delta ?? 0) + delta
  await tx.tharaCreditLedger.create({
    data: {
      userId: referral.referrer.userId,
      delta,
      reason: TharaCreditReason.REFERRAL_COMMISSION,
      sourceOrderId: order.id,
      balanceAfter,
    },
  })
}

/** Current spendable balance for a user. Clamped to ≥ 0 (a negative running
 *  balance from a refund clawback cannot be spent). */
export async function getTharaCreditBalance(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<number> {
  const agg = await tx.tharaCreditLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  })
  return Math.max(0, agg._sum.delta ?? 0)
}

/**
 * Debit up to `wantPaise` from the buyer's credit balance and return the
 * actual amount applied. Called from placeOrder INSIDE the same transaction
 * so a concurrent checkout can't double-spend the same balance.
 */
export async function applyTharaCredit(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  wantPaise: number,
): Promise<number> {
  if (!isTharaEnabled()) return 0
  if (wantPaise <= 0) return 0

  const balance = await getTharaCreditBalance(tx, userId)
  const apply = Math.min(balance, wantPaise)
  if (apply <= 0) return 0

  const prior = await tx.tharaCreditLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  })
  const balanceAfter = (prior._sum.delta ?? 0) - apply
  await tx.tharaCreditLedger.create({
    data: {
      userId,
      delta: -apply,
      reason: TharaCreditReason.CHECKOUT_SPEND,
      sourceOrderId: orderId,
      balanceAfter,
    },
  })
  return apply
}

/**
 * Called inside refundOrder's transaction. For every ledger row that
 * references this order (an earned commission on the referrer, or a spent
 * credit on the buyer), write a mirror-signed reversal row.
 *
 * It runs at most once per order, so it can safely reverse every source row
 * without re-checking for prior reversals — but NOT for the reason this note
 * used to give. It said "because refundOrder gates on status === 'paid'", and
 * that gate has since widened: a cancelled order whose money was never returned
 * is refundable too. The guarantee has always come from somewhere else, and
 * still holds: `reverseBooksForRefund` reaches this only after a compare-and-
 * swap flips the order to 'refunded', and an order can make that transition
 * once. Widening the entry states does not widen the number of reversals.
 */
export async function reverseTharaCreditForRefund(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const rows = await tx.tharaCreditLedger.findMany({
    where: {
      sourceOrderId: orderId,
      reason: { in: [TharaCreditReason.REFERRAL_COMMISSION, TharaCreditReason.CHECKOUT_SPEND] },
    },
    orderBy: { createdAt: 'asc' },
  })
  for (const row of rows) {
    const reversedDelta = -row.delta
    const prior = await tx.tharaCreditLedger.aggregate({
      where: { userId: row.userId },
      _sum: { delta: true },
    })
    const balanceAfter = (prior._sum.delta ?? 0) + reversedDelta
    await tx.tharaCreditLedger.create({
      data: {
        userId: row.userId,
        delta: reversedDelta,
        reason: TharaCreditReason.REFUND_REVERSAL,
        sourceOrderId: orderId,
        balanceAfter,
      },
    })
  }
}

// ─────────────────────── Sub-project B: personal discount ──────────────────

/** Slab thresholds in paise. Matches PROGRAM.md §5 and the PRD's §6 slab table. */
export const TharaDiscountSlabs = {
  SLAB_1_MIN: 300_000, // ₹3,000 — 10% off
  SLAB_2_MIN: 600_000, // ₹6,000 — 15% off
  SLAB_3_MIN: 900_000, // ₹9,000 — 20% off
} as const

export type TharaDiscountSlab = '10' | '15' | '20'

export interface TharaDiscountResult {
  /** True only when the flag is on, the user is an active member, AND subtotal ≥ ₹3,000. */
  eligible: boolean
  slab: TharaDiscountSlab | null
  /** Integer paise. Zero when not eligible. */
  discountPaise: number
}

/**
 * Compute the personal-discount amount for a checkout. Called from placeOrder
 * inside the checkout transaction (uses the tx client so a rollback wipes the
 * membership read too — cheap consistency).
 *
 * Discount is applied ONLY when:
 *  - THARA_ENABLED is true
 *  - The user has a TharaMembership in status='active' (not purchase_pending,
 *    not suspended, not deactivated)
 *  - Cart subtotal ≥ ₹3,000
 */
export async function computeTharaDiscount(
  tx: Prisma.TransactionClient,
  userId: string | null | undefined,
  subtotalPaise: number,
): Promise<TharaDiscountResult> {
  const zero: TharaDiscountResult = { eligible: false, slab: null, discountPaise: 0 }
  if (!isTharaEnabled()) return zero
  if (!userId || subtotalPaise < TharaDiscountSlabs.SLAB_1_MIN) return zero

  const membership = await tx.tharaMembership.findUnique({
    where: { userId },
    select: { status: true },
  })
  if (!membership || membership.status !== 'active') return zero

  let pct: number
  let slab: TharaDiscountSlab
  if (subtotalPaise >= TharaDiscountSlabs.SLAB_3_MIN) {
    pct = 20
    slab = '20'
  } else if (subtotalPaise >= TharaDiscountSlabs.SLAB_2_MIN) {
    pct = 15
    slab = '15'
  } else {
    pct = 10
    slab = '10'
  }
  // floor so we never round up and end up giving MORE discount than the slab says
  const discountPaise = Math.floor((subtotalPaise * pct) / 100)
  return { eligible: true, slab, discountPaise }
}

/** A membership row plus just enough of the account to identify the human behind
 *  it. The admin console searches by email, so listing without it forced the
 *  operator to match people by referral code alone. */
export type TharaMembershipRow = TharaMembership & {
  user: { id: string; name: string | null; email: string | null; phone: string | null }
}

export async function listMemberships(brand: Brand, filter: {
  status?: TharaStatus
  q?: string
  take: number
  skip: number
}): Promise<{ rows: TharaMembershipRow[]; total: number }> {
  const prisma = dbFor(brand)
  const where: Prisma.TharaMembershipWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.q
      ? {
          OR: [
            { referralCode: { contains: filter.q.toUpperCase() } },
            { user: { email: { contains: filter.q.toLowerCase() } } },
          ],
        }
      : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.tharaMembership.findMany({
      where,
      take: filter.take,
      skip: filter.skip,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, phone: true } } },
    }),
    prisma.tharaMembership.count({ where }),
  ])
  return { rows, total }
}

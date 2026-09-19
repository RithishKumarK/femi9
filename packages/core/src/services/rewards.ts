import 'server-only'
import { randomBytes } from 'node:crypto'
import type { CouponType } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { sendEmailNotification } from './notifications'
import { sendTextSms } from '../otp'
import { logger } from '../logger'

/**
 * Rewards service — the catalogue of redeemable perks and the redemption itself.
 *
 * Redeeming turns Bloom points into a real, usable Coupon: it debits the points
 * ledger and mints a coupon in ONE transaction so a customer can never end up
 * with a coupon they didn't pay points for, or a debit with no coupon. Points are
 * the currency; the balance is always the running sum of the ledger (the exact
 * source of truth the checkout award path writes to), so a redemption can only
 * ever spend points that were genuinely earned.
 */

/** Balance is short of the reward's cost. Route maps this to a 400. */
export class InsufficientPointsError extends Error {
  constructor() {
    super('You do not have enough Bloom points for this reward yet.')
    this.name = 'InsufficientPointsError'
  }
}

/** The requested reward is gone or deactivated between page load and redeem.
 *  Route maps this to a 400 (stale reference), not a 500. */
export class RewardOptionNotFoundError extends Error {
  constructor() {
    super('That reward is no longer available.')
    this.name = 'RewardOptionNotFoundError'
  }
}

/** Reward option shaped for the storefront card (no internal-only fields). */
export interface RewardOptionView {
  id: string
  title: string
  costPoints: number
  couponType: CouponType
  couponValue: number
}

/** The active reward catalogue, in the admin-defined display order. */
export async function listRewardOptions(brand: Brand): Promise<RewardOptionView[]> {
  const prisma = dbFor(brand)
  const opts = await prisma.rewardOption.findMany({
    where: { active: true },
    orderBy: [{ position: 'asc' }, { costPoints: 'asc' }],
  })
  return opts.map((o) => ({
    id: o.id,
    title: o.title,
    costPoints: o.costPoints,
    couponType: o.couponType,
    couponValue: o.couponValue,
  }))
}

// Crockford-style alphabet (no 0/O/1/I) so a redeemed code reads back cleanly from
// an email. 10 symbols over a 32-char set ≈ 50 bits of entropy — collision odds
// against Coupon.code's @unique index are negligible, so we don't loop-retry
// inside the transaction (a retry there would abort the whole tx anyway).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateCouponCode(): string {
  const bytes = randomBytes(10)
  let body = ''
  for (let i = 0; i < 10; i++) body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `BLOOM-${body}`
}

// A redeemed coupon is personal + single-use and lapses after 90 days so an unused
// reward doesn't sit as an open discount liability forever.
const COUPON_TTL_DAYS = 90

export interface RedeemResult {
  couponCode: string
}

/**
 * Redeem a reward for `userId`: verify the balance covers the cost, write the
 * negative points debit, and issue the coupon — atomically. Throws
 * InsufficientPointsError when short, RewardOptionNotFoundError for a bad id.
 */
export async function redeem(brand: Brand, userId: string, rewardOptionId: string): Promise<RedeemResult> {
  const prisma = dbFor(brand)
  const result = await prisma.$transaction(async (tx) => {
    const option = await tx.rewardOption.findUnique({ where: { id: rewardOptionId } })
    if (!option || !option.active) throw new RewardOptionNotFoundError()

    const agg = await tx.pointsLedger.aggregate({ where: { userId }, _sum: { delta: true } })
    const balance = agg._sum.delta ?? 0
    if (balance < option.costPoints) throw new InsufficientPointsError()

    const balanceAfter = balance - option.costPoints
    // Negative ledger row — the spend is recorded like a bank debit, carrying the
    // running balanceAfter so points history stays reconstructable.
    await tx.pointsLedger.create({
      data: {
        userId,
        delta: -option.costPoints,
        reason: `Redeemed: ${option.title}`,
        balanceAfter,
      },
    })

    const coupon = await tx.coupon.create({
      data: {
        code: generateCouponCode(),
        type: option.couponType,
        value: option.couponValue,
        minOrder: 0,
        maxUses: 1, // one redemption == one usable coupon
        // Bound to the customer who paid points for it. Without this anyone who
        // learned a BLOOM- code could spend its single use; the checkout claim
        // re-asserts the same ownership.
        userId,
        expiresAt: new Date(Date.now() + COUPON_TTL_DAYS * 24 * 60 * 60 * 1000),
        active: true,
      },
    })

    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } })
    return { couponCode: coupon.code, email: user?.email ?? null, phone: user?.phone ?? null }
  })

  // Deliver on EVERY channel the customer actually has. Email alone stranded
  // every phone-OTP signup (email is null for all of them), and the on-screen
  // flash was destroyed by the very router.refresh() that follows a redeem — so
  // the code was shown once and lost. The account page also lists owned coupons
  // now; these sends are the belt to that braces.
  if (result.email) {
    await sendEmailNotification(brand, {
      userId,
      to: result.email,
      subject: 'Your Femi9 Bloom reward code',
      text: `Your reward code is ${result.couponCode}. Enter it at checkout.`,
      html: `<p>Your reward code is <strong>${result.couponCode}</strong>. Enter it at checkout.</p>`,
      template: 'reward-coupon',
      dedupeKey: `reward-coupon:${result.couponCode}`,
    })
  }
  if (result.phone) {
    const sms = await sendTextSms(result.phone, { code: result.couponCode })
    if (!sms.sent) {
      // Never throw: the points are already spent and the coupon exists. Log so
      // ops can see that a delivery channel is unprovisioned.
      logger.warn('reward_coupon_sms_failed', { userId, reason: sms.reason })
    }
  }
  return { couponCode: result.couponCode }
}

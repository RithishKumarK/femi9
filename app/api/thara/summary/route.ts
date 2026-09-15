import { handle, ok, unauthorized, notFound } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { isTharaEnabled } from '@femi9/core/thara/feature'
import {
  getMembership,
  getTharaCreditBalance,
  currentOpenCycle,
  getUserCyclePoints,
  getUnlockProgress,
  syncTharaActivation,
  THARA_VOUCHER_MULTIPLIER,
  THARA_VOUCHER_CLAIM_DAYS,
  THARA_QUALIFYING_MIN_PAISE,
  THARA_COMMISSION_PCT,
  THARA_POINTS_PCT,
  TharaDiscountSlabs,
} from '@femi9/core/services/thara'
import { prisma } from '@/lib/db'

/**
 * Every number the explainer UI prints, sent from the server rather than
 * duplicated as copy in the page. If ops retunes a slab, the page that teaches
 * the programme cannot drift away from the engine that applies it.
 */
const RULES = {
  minOrderPaise: THARA_QUALIFYING_MIN_PAISE,
  commissionPct: THARA_COMMISSION_PCT,
  pointsPct: THARA_POINTS_PCT,
  voucherMultiplier: THARA_VOUCHER_MULTIPLIER,
  voucherClaimDays: THARA_VOUCHER_CLAIM_DAYS,
  slabs: [
    { minPaise: TharaDiscountSlabs.SLAB_1_MIN, maxPaise: TharaDiscountSlabs.SLAB_2_MIN - 1, pct: 10 },
    { minPaise: TharaDiscountSlabs.SLAB_2_MIN, maxPaise: TharaDiscountSlabs.SLAB_3_MIN - 1, pct: 15 },
    { minPaise: TharaDiscountSlabs.SLAB_3_MIN, maxPaise: null, pct: 20 },
  ],
} as const

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/thara/summary — the one-shot payload the customer dashboard
 * reads to render every Thara section (membership + referral + wallet +
 * points + vouchers + downline count). All computed server-side so the
 * client renders a static tree.
 */
export async function GET() {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()
    const session = await getSession('femi9')
    if (!session) return unauthorized()

    const userId = session.sub

    // Promote a member whose qualifying order predates her enrolment before
    // reading her status, so the dashboard never reports "not unlocked yet" to
    // someone who has already paid for the unlock.
    await syncTharaActivation('femi9', userId)

    const m = await getMembership('femi9', userId)
    if (!m) {
      // The join screen teaches the same programme with the same numbers, and
      // tells a shopper who has already qualified that joining unlocks her
      // immediately.
      return ok({ enrolled: false, rules: RULES, unlock: await getUnlockProgress('femi9', userId) })
    }

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? ''
    const referralUrl = base ? `${base}/r/${m.referralCode}` : `/r/${m.referralCode}`

    const [
      creditBalance,
      cycle,
      recentCreditRows,
      vouchers,
      downlineCount,
      incomingReferral,
      unlock,
    ] = await Promise.all([
      getTharaCreditBalance(prisma, userId),
      currentOpenCycle('femi9'),
      prisma.tharaCreditLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.tharaVoucher.findMany({
        where: { userId },
        orderBy: { issuedAt: 'desc' },
        take: 10,
      }),
      prisma.tharaReferral.count({ where: { referrerId: m.id } }),
      prisma.tharaReferral.findUnique({
        where: { referredUserId: userId },
        include: { referrer: { select: { referralCode: true } } },
      }),
      getUnlockProgress('femi9', userId),
    ])

    const currentCyclePoints = await getUserCyclePoints('femi9', userId, cycle.id)

    return ok({
      enrolled: true,
      rules: RULES,
      unlock,
      membership: {
        status: m.status,
        referralCode: m.referralCode,
        referralUrl,
        enrolledAt: m.enrolledAt,
        activatedAt: m.activatedAt,
      },
      referrerCode: incomingReferral?.referrer.referralCode ?? null,
      downlineCount,
      credit: {
        balancePaise: creditBalance,
        recentRows: recentCreditRows.map((r) => ({
          id: r.id,
          delta: r.delta,
          reason: r.reason,
          sourceOrderId: r.sourceOrderId,
          balanceAfter: r.balanceAfter,
          createdAt: r.createdAt,
        })),
      },
      cycle: {
        id: cycle.id,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        status: cycle.status,
        currentPoints: currentCyclePoints,
        estimatedVoucherRupees: currentCyclePoints * THARA_VOUCHER_MULTIPLIER,
      },
      vouchers: vouchers.map((v) => ({
        id: v.id,
        cycleId: v.cycleId,
        points: v.points,
        valuePaise: v.valuePaise,
        status: v.status,
        issuedAt: v.issuedAt,
        claimDeadline: v.claimDeadline,
        claimedAt: v.claimedAt,
        hasAmazonCode: !!v.amazonCode,
        amazonCode: v.status === 'claimed' ? v.amazonCode : null,
      })),
    })
  })
}

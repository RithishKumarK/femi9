import 'server-only'
import { Prisma } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../brands'
import { createPlan, type PlanPeriod } from '../razorpay'

/**
 * Razorpay Plan resolution and caching.
 *
 * A Plan on Razorpay is nothing but (amount, period, interval) — no customer, no
 * product, no address. So every subscription that bills the same rupees on the
 * same rhythm can share one, and the natural key is exactly those three values.
 *
 * That matters because plans are **immutable and undeletable**. Creating one per
 * subscribe click would leave the merchant account with thousands of identical
 * plans and no way to tidy them, so `resolvePlan` reads the `RazorpayPlan` cache
 * first and only calls the gateway on a genuine miss.
 */

/** Cadence intervals we will not translate. Razorpay caps `interval`, and a
 *  nonsense cadence (0 days, a year) should fail loudly at subscribe time
 *  rather than become a mandate that debits on a rhythm nobody intended. */
export class UnsupportedCadenceError extends Error {
  constructor(days: number) {
    super(`Cannot express a ${days}-day cadence as a Razorpay plan`)
    this.name = 'UnsupportedCadenceError'
  }
}

export interface PlanRhythm {
  period: PlanPeriod
  interval: number
}

/**
 * Turn a cadence measured in DAYS into Razorpay's period + interval.
 *
 * Whole weeks become weekly plans, because that is what they are and it is what
 * the customer's bank statement will say: 28 days is "every 4 weeks", not "every
 * 28 days". Everything else falls back to a daily interval, which is exact for
 * any day count — Femi9's `cycle` cadence is 25 days and has no weekly form.
 *
 * Deliberately NOT monthly. A monthly plan bills on a calendar date, so a
 * 28-day refill mapped to "monthly" would drift a day or three every cycle
 * against the delivery rhythm the customer was actually shown.
 */
export function rhythmForDays(days: number): PlanRhythm {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new UnsupportedCadenceError(days)
  if (days % 7 === 0) return { period: 'weekly', interval: days / 7 }
  return { period: 'daily', interval: days }
}

/** The natural key: same rupees, same rhythm ⇒ same plan. Rendered as a string
 *  so it can be a unique column and be reasoned about in the database. */
export function planFingerprint({ period, interval }: PlanRhythm, amountRupees: number): string {
  return `${period}:${interval}:${amountRupees}`
}

/**
 * The Razorpay plan id for this amount + rhythm, creating it on first use.
 *
 * Two shoppers subscribing to the same box at the same second both miss the
 * cache and both create a plan at the gateway. That is unavoidable — there is no
 * conditional create — so the loser of the `fingerprint` unique index simply
 * re-reads the winner's row and uses the winner's plan. It abandons a duplicate
 * plan on the Razorpay account, which is harmless (plans cost nothing and are
 * never listed to customers) and is much cheaper than serialising every
 * subscribe behind a lock.
 */
export async function resolvePlanId(
  brand: Brand,
  { days, amountRupees, label }: { days: number; amountRupees: number; label: string },
): Promise<string> {
  const prisma = dbFor(brand)
  const rhythm = rhythmForDays(days)
  const fingerprint = planFingerprint(rhythm, amountRupees)

  const cached = await prisma.razorpayPlan.findUnique({ where: { fingerprint } })
  if (cached) return cached.razorpayPlanId

  const plan = await createPlan(brand, {
    period: rhythm.period,
    interval: rhythm.interval,
    // Shown on the customer's mandate approval screen and on her bank statement,
    // so it names the brand and the rhythm rather than an internal fingerprint.
    name: `${brandConfig(brand).name} — ${label}`,
    amountRupees,
    notes: { brand, fingerprint },
  })

  try {
    const row = await prisma.razorpayPlan.create({
      data: {
        fingerprint,
        razorpayPlanId: plan.id,
        amount: amountRupees,
        period: rhythm.period,
        interval: rhythm.interval,
      },
    })
    return row.razorpayPlanId
  } catch (err) {
    // Lost the race — another request cached a plan for this exact fingerprint
    // while our gateway call was in flight. Use theirs.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.razorpayPlan.findUnique({ where: { fingerprint } })
      if (winner) return winner.razorpayPlanId
    }
    throw err
  }
}

import 'server-only'
import type { AffiliateStatus, PayoutStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../../brands'
import { logger } from '../../logger'
import { isPlaceholder } from '../affiliate'
import { sendEmailNotification } from '../notifications'

/**
 * Admin affiliate service — the seam between the DB and the creator-program
 * console. Reads roll clicks/orders/earnings up from AffiliateEvent; the writes
 * are the review actions (approve / suspend) and payout logging.
 *
 * Approval is where a real, shareable promoCode is minted — until then the row
 * carries an internal placeholder (see services/affiliate.ts), which this module
 * never surfaces as a code.
 */

/** One creator row for the admin table. `promoCode` is null until approved. */
export interface AffiliateListItem {
  id: string
  handle: string
  email: string | null
  platform: string | null
  followerBand: string | null
  promoCode: string | null
  status: AffiliateStatus
  clicks: number
  orders: number
  earnings: number
  createdAt: Date
}

/** A logged payout, shaped for the admin payout panel. */
export interface PayoutListItem {
  id: string
  affiliateId: string
  amount: number
  status: PayoutStatus
  periodStart: Date
  periodEnd: Date
  reference: string | null
  paidAt: Date | null
  createdAt: Date
}

/** Per-affiliate event rollup: clicks, attributed orders, total commission. */
interface EventTotals {
  clicks: number
  orders: number
  earnings: number
}

const ZERO_TOTALS: EventTotals = { clicks: 0, orders: 0, earnings: 0 }

/** Roll one affiliate's events up into clicks/orders/earnings. */
async function totalsFor(brand: Brand, affiliateId: string): Promise<EventTotals> {
  const prisma = dbFor(brand)
  const rows = await prisma.affiliateEvent.groupBy({
    by: ['type'],
    where: { affiliateId },
    _count: { _all: true },
    _sum: { commission: true },
  })
  const totals: EventTotals = { ...ZERO_TOTALS }
  for (const r of rows) {
    if (r.type === 'click') totals.clicks = r._count._all
    else if (r.type === 'order') {
      totals.orders = r._count._all
      totals.earnings = r._sum.commission ?? 0
    }
  }
  return totals
}

/** Shape a single affiliate (with email + totals) into a list item. Placeholder
 *  codes are surfaced as null so the console never shows a non-shareable code. */
function toListItem(
  a: { id: string; handle: string; platform: string | null; followerBand: string | null; promoCode: string; status: AffiliateStatus; createdAt: Date; user: { email: string | null } },
  totals: EventTotals,
): AffiliateListItem {
  return {
    id: a.id,
    handle: a.handle,
    email: a.user.email,
    platform: a.platform,
    followerBand: a.followerBand,
    promoCode: isPlaceholder(a.promoCode) ? null : a.promoCode,
    status: a.status,
    clicks: totals.clicks,
    orders: totals.orders,
    earnings: totals.earnings,
    createdAt: a.createdAt,
  }
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** Every creator, newest first, with computed clicks/orders/earnings + email. */
export async function listAffiliates(brand: Brand): Promise<AffiliateListItem[]> {
  const prisma = dbFor(brand)
  try {
    const affiliates = await prisma.affiliate.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } },
    })

    const grouped = await prisma.affiliateEvent.groupBy({
      by: ['affiliateId', 'type'],
      _count: { _all: true },
      _sum: { commission: true },
    })
    const totalsByAff = new Map<string, EventTotals>()
    for (const g of grouped) {
      const t = totalsByAff.get(g.affiliateId) ?? { ...ZERO_TOTALS }
      if (g.type === 'click') t.clicks = g._count._all
      else if (g.type === 'order') {
        t.orders = g._count._all
        t.earnings = g._sum.commission ?? 0
      }
      totalsByAff.set(g.affiliateId, t)
    }

    return affiliates.map((a) => toListItem(a, totalsByAff.get(a.id) ?? { ...ZERO_TOTALS }))
  } catch {
    return []
  }
}

/** Refresh one row (used after a status change) or null if it's gone. */
async function listItem(brand: Brand, id: string): Promise<AffiliateListItem | null> {
  const prisma = dbFor(brand)
  const a = await prisma.affiliate.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  })
  if (!a) return null
  return toListItem(a, await totalsFor(brand, id))
}

/** Payouts, newest first — all, or scoped to one affiliate. */
export async function listPayouts(brand: Brand, affiliateId?: string): Promise<PayoutListItem[]> {
  const prisma = dbFor(brand)
  const rows = await prisma.affiliatePayout.findMany({
    where: affiliateId ? { affiliateId } : {},
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((p) => ({
    id: p.id,
    affiliateId: p.affiliateId,
    amount: p.amount,
    status: p.status,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    reference: p.reference,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  }))
}

// ─────────────────────────────── Writes ─────────────────────────────────

/** Build a unique promoCode from the handle: uppercase alphanumerics, deduped
 *  with a numeric suffix. The DB @unique on promoCode is the real backstop; this
 *  loop just avoids the collision in the common case. */
async function allocateCode(brand: Brand, handle: string): Promise<string> {
  const prisma = dbFor(brand)
  const base = handle.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12) || 'CREATOR'
  let candidate = base
  let n = 1
  // eslint-disable-next-line no-await-in-loop -- collisions are rare; loop is bounded in practice
  while (await prisma.affiliate.findUnique({ where: { promoCode: candidate }, select: { id: true } })) {
    n += 1
    candidate = `${base}${n}`
  }
  return candidate
}

/**
 * Approve a creator: flip to 'approved' and allocate their real promoCode. If
 * they already hold a real code (e.g. re-approving after a suspension) it's kept
 * so their live links keep working. Returns the refreshed row, or null if gone.
 */
export async function approve(brand: Brand, id: string): Promise<AffiliateListItem | null> {
  const prisma = dbFor(brand)
  const current = await prisma.affiliate.findUnique({
    where: { id },
    select: { handle: true, promoCode: true, userId: true, user: { select: { email: true, name: true } } },
  })
  if (!current) return null

  const promoCode = isPlaceholder(current.promoCode)
    ? await allocateCode(brand, current.handle)
    : current.promoCode

  await prisma.affiliate.update({
    where: { id },
    data: { status: 'approved', promoCode },
  })

  // Send the email both brands' /affiliate pages promise. Until now `approve`
  // only wrote the row, so that promise was never kept and the creator had no
  // way to learn her own code.
  await sendApprovalEmail(brand, id, current.user?.email ?? null, current.user?.name ?? null, promoCode)

  return listItem(brand, id)
}

/**
 * The tracked share URL for ONE brand's creator. Commission is only attributed
 * to visitors who arrive through /a/<code>, so the code alone is not enough —
 * send the link too.
 *
 * The origin has to come from the BRAND, not from the process. This runs in the
 * console, which serves both brands from a single container with a single
 * environment: reading `NEXT_PUBLIC_SITE_URL` gave every creator of both brands
 * the same origin. In practice the console sets no such variable, so the link
 * was `/a/CODE` — a bare path, in an email, where nothing resolves it — and
 * setting it would have been worse than leaving it unset, because then a Lumi9
 * creator's link would have pointed at Femi9's storefront and attributed her
 * referrals to a schema her code does not exist in.
 *
 * `brandConfig(brand).host` is the public storefront hostname and needs no
 * configuration to be right. The per-brand override exists for staging, where
 * the storefronts are not on their production domains.
 */
function shareUrl(brand: Brand, promoCode: string): string {
  const override = process.env[`STOREFRONT_URL_${brand.toUpperCase()}`]?.trim().replace(/\/$/, '')
  const origin = override || `https://${brandConfig(brand).host}`
  return `${origin}/a/${promoCode}`
}

async function sendApprovalEmail(brand: Brand, 
  affiliateId: string,
  email: string | null,
  name: string | null,
  promoCode: string,
): Promise<void> {
  if (!email) {
    logger.warn('affiliate_approval_no_email', { affiliateId })
    return
  }
  const url = shareUrl(brand, promoCode)
  const greeting = name?.trim().split(' ')[0] || 'there'
  // Named for the brand that approved her. The two programmes are separate
  // rosters in separate schemas, and a Lumi9 creator told she has a "Femi9
  // code" would try it on the wrong storefront, where it resolves to nothing.
  const brandName = brandConfig(brand).name
  await sendEmailNotification(brand, {
    to: email,
    subject: `You are approved - here is your ${brandName} creator code`,
    text: `Hi ${greeting},

You're in. Your ${brandName} creator code is ${promoCode}.

Share this link so your clicks and commission are tracked:
${url}

${brandName}`,
    html: `<p>Hi ${greeting},</p><p>You're in. Your ${brandName} creator code is <strong>${promoCode}</strong>.</p><p>Share this link so your clicks and commission are tracked:<br><a href="${url}">${url}</a></p><p>${brandName}</p>`,
    template: 'affiliate-approved',
    // Keyed on the allocated code, not the row, so re-approving after a
    // suspension does not re-send an identical email.
    dedupeKey: `affiliate-approved:${affiliateId}:${promoCode}`,
  })
}

/** Suspend a creator (their code stops attributing). Null if the row is gone. */
export async function suspend(brand: Brand, id: string): Promise<AffiliateListItem | null> {
  const prisma = dbFor(brand)
  const res = await prisma.affiliate.updateMany({ where: { id }, data: { status: 'suspended' } })
  if (res.count === 0) return null
  return listItem(brand, id)
}

/**
 * Log a payout for a period. Records the admin's statement that commission was
 * (or is being) paid; status defaults to 'pending' per the schema.
 */
export async function createPayout(brand: Brand, 
  affiliateId: string,
  amount: number,
  periodStart: Date,
  periodEnd: Date,
  reference?: string,
): Promise<PayoutListItem> {
  const prisma = dbFor(brand)
  const p = await prisma.affiliatePayout.create({
    data: {
      affiliateId,
      amount,
      periodStart,
      periodEnd,
      reference: reference?.trim() || null,
    },
  })
  return {
    id: p.id,
    affiliateId: p.affiliateId,
    amount: p.amount,
    status: p.status,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    reference: p.reference,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  }
}

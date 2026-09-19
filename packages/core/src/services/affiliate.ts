import 'server-only'
import { Prisma, type AffiliateStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../brands'
import { logger } from '../logger'
import { sendEmailNotification } from './notifications'

/**
 * Affiliate (creator) program — server-tracked application, click attribution
 * and order commission. Replaces the old client-side "generate a code in the
 * browser + localStorage" flow so codes, clicks and earnings are real DB state.
 *
 * Two facts from the schema shape this file:
 *  - `Affiliate.promoCode` is REQUIRED and @unique, yet a real, shareable code
 *    isn't allocated until an admin approves the application. We therefore park a
 *    unique, non-user-facing PLACEHOLDER at apply time (keyed to the unique
 *    userId) and swap in the real code on approval. `isPlaceholder` keeps that
 *    detail in one place so no read surface ever leaks a placeholder as a usable
 *    code.
 *  - Attribution only ever fires for an APPROVED affiliate — click logging and
 *    order commission are silent no-ops for pending/suspended/unknown codes, so a
 *    stale or guessed link can never create tracking noise.
 */

/**
 * Cookie the creator referral redirect (/a/[code]) drops so checkout can
 * attribute a later purchase back to the referring creator. Shared here so the
 * setter and the reader agree on one name. (/r/[code] is the separate Thara
 * membership referral and uses its own signed cookie.)
 *
 * Per brand, for the same reason `sessionCookieName` is: the two storefronts
 * are separate hosts in production, but they are the SAME host in development
 * and in the E2E suites (cookies ignore the port), so one shared `femi9_ref`
 * would follow a shopper from one brand's referral link into the other brand's
 * checkout. The affiliate tables live in per-brand Postgres schemas, so the
 * stray code would resolve to nothing and attribute nothing — but "it happens
 * to miss" is not isolation. The name derives to exactly what Femi9 already
 * issues, so no live referral cookie was invalidated by making this
 * brand-aware.
 */
export function refCookieName(brand: Brand): string {
  return `${brand}_ref`
}

/** @deprecated Femi9's cookie name. Use `refCookieName(brand)`. */
export const REF_COOKIE = 'femi9_ref'

/** Commission paid to the creator on an attributed order, as a fraction of the
 *  order SUBTOTAL. The marketing page quotes a headline rate; the program spec
 *  fixes attribution at 10% — one constant so checkout and reporting never drift. */
const COMMISSION_RATE = 0.1

/** Prefix marking a not-yet-allocated placeholder promoCode (see file header). */
const PLACEHOLDER_PREFIX = 'PENDING-'

/** A promoCode that is only a placeholder — never a real, shareable code. */
export function isPlaceholder(code: string): boolean {
  return code.startsWith(PLACEHOLDER_PREFIX)
}

/** Build the unique placeholder for a freshly-applied affiliate. Keyed to the
 *  (unique) userId so it satisfies the @unique index without any coordination. */
export function placeholderCode(userId: string): string {
  return `${PLACEHOLDER_PREFIX}${userId}`
}

/** Reads/writes here accept either the shared client or a transaction client, so
 *  checkout can attribute an order inside its own atomic transaction. The full
 *  PrismaClient is assignable to TransactionClient, so `prisma` is a valid default. */
type Db = Prisma.TransactionClient

/** Codes are matched case-insensitively; canonicalise to trimmed uppercase. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

export interface AffiliateApplication {
  name: string
  handle: string
  platform?: string
  followerBand?: string
  email: string
}

/**
 * Register (or refresh) a creator application.
 *
 * Upserts a User by email, then upserts the Affiliate keyed to that user.
 * Re-applying updates only the application details; it deliberately leaves
 * `status` and `promoCode` untouched so an already-approved creator can never be
 * demoted or lose their live code by resubmitting the form.
 *
 * ── An email in a public request body is not an identity claim ──────────────
 * This is reached UNAUTHENTICATED — `/api/affiliate/apply` takes the address
 * straight from the form. The upsert used to carry `update: { name: input.name }`,
 * so anyone who knew (or guessed) a shopper's address could rewrite the name on
 * her account: the name on her orders, her delivery label and every email we
 * send her. No sign-in, no verification, one form post.
 *
 * The existing-user branch now writes NOTHING to `User`. An application is a
 * claim about a person, and the only thing it may create is the row that
 * records the claim — an admin approving it in the console is what turns it
 * into anything. `name` on a row that already exists belongs to whoever proved
 * they own that address.
 *
 * `role: 'affiliate'` stays on the CREATE path only. It was already scoped that
 * way and the comment below explains why; what matters is that it can no longer
 * be applied to somebody else's existing account.
 */
export async function apply(brand: Brand, input: AffiliateApplication): Promise<void> {
  const prisma = dbFor(brand)
  // Lowercased, not merely trimmed. Every sign-in path normalises through
  // `normalizeEmail` (trim + toLowerCase), so `Priya@Gmail.com` here created a
  // SECOND User row that no sign-in could ever reach: the creator was approved,
  // given a live promo code, and then locked out of the dashboard that reports
  // her earnings, because `/api/affiliate/me` looks up the session's user and
  // finds no Affiliate on it. Her links still paid out — to a row she cannot see.
  const email = input.email.trim().toLowerCase()
  const handle = input.handle.replace(/^@+/, '').trim()
  const platform = input.platform?.trim() || null
  const followerBand = input.followerBand?.trim() || null

  // role 'affiliate' is intentional on create: creator accounts are a distinct
  // identity from shoppers (and are excluded from the customers admin). We never
  // change role on update, so an existing customer applying keeps their role.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  const user =
    existing ??
    (await prisma.user.create({ data: { email, name: input.name, role: 'affiliate' } }))

  const affiliate = await prisma.affiliate.upsert({
    where: { userId: user.id },
    update: { handle, platform, followerBand },
    create: {
      userId: user.id,
      handle,
      platform,
      followerBand,
      status: 'pending',
      promoCode: placeholderCode(user.id), // real code allocated on approval
    },
    select: { id: true },
  })

  // Tell ops a creator is waiting. Mirrors services/partner.ts — an application
  // that lands in a table nobody watches is the same as no application. Never
  // throws: a mail outage must not fail the applicant's submission.
  const opsEmail = process.env.PARTNER_OPS_EMAIL?.trim()
  if (!opsEmail) {
    logger.warn('affiliate_application_no_ops_recipient', { affiliateId: affiliate.id })
    return
  }
  try {
    await sendEmailNotification(brand, {
      to: opsEmail,
      subject: `New ${brandConfig(brand).name} creator application: @${handle}`,
      text: `${input.name} (@${handle}${platform ? `, ${platform}` : ''}${followerBand ? `, ${followerBand}` : ''}) applied. Review in the admin console.`,
      html: `<p><strong>${input.name}</strong> (@${handle}${platform ? `, ${platform}` : ''}${followerBand ? `, ${followerBand}` : ''}) applied. Review in the admin console.</p>`,
      template: 'affiliate-application-ops',
      dedupeKey: `affiliate-application:${affiliate.id}:ops`,
    })
  } catch (err) {
    logger.error('affiliate_application_ops_mail_failed', { affiliateId: affiliate.id, err: String(err) })
  }
}

export interface AffiliateStats {
  status: AffiliateStatus
  promoCode: string
  clicks: number
  orders: number
  earnings: number
}

/**
 * Public stats for a code — clicks, attributed orders and total commission,
 * aggregated from AffiliateEvent. Returns null for an unknown code. Because the
 * lookup is uppercased, placeholder (mixed-case) codes never resolve here, so a
 * pending application's internal code can't be probed.
 */
export async function getByCode(brand: Brand, promoCode: string): Promise<AffiliateStats | null> {
  const prisma = dbFor(brand)
  const code = normalizeCode(promoCode)
  const affiliate = await prisma.affiliate.findUnique({
    where: { promoCode: code },
    select: { id: true, status: true, promoCode: true },
  })
  if (!affiliate) return null

  const [clicks, orderAgg] = await Promise.all([
    prisma.affiliateEvent.count({ where: { affiliateId: affiliate.id, type: 'click' } }),
    prisma.affiliateEvent.aggregate({
      where: { affiliateId: affiliate.id, type: 'order' },
      _count: { _all: true },
      _sum: { commission: true },
    }),
  ])

  return {
    status: affiliate.status,
    promoCode: affiliate.promoCode,
    clicks,
    orders: orderAgg._count._all,
    earnings: orderAgg._sum.commission ?? 0,
  }
}

/** Owner-scoped affiliate dashboard. Promo codes are public; earnings are not. */
export async function getForUser(brand: Brand, userId: string): Promise<AffiliateStats | null> {
  const prisma = dbFor(brand)
  const affiliate = await prisma.affiliate.findUnique({
    where: { userId },
    select: { id: true, status: true, promoCode: true },
  })
  if (!affiliate || isPlaceholder(affiliate.promoCode)) return null
  const [clicks, orderAgg] = await Promise.all([
    prisma.affiliateEvent.count({ where: { affiliateId: affiliate.id, type: 'click' } }),
    prisma.affiliateEvent.aggregate({
      where: { affiliateId: affiliate.id, type: 'order' },
      _count: { _all: true },
      _sum: { commission: true },
    }),
  ])
  return {
    status: affiliate.status,
    promoCode: affiliate.promoCode,
    clicks,
    orders: orderAgg._count._all,
    earnings: orderAgg._sum.commission ?? 0,
  }
}

/**
 * Record a click for an approved code — called by the /a/[code] redirect.
 * Silently ignores unknown/pending/suspended codes so a bad link is harmless.
 */
export async function logClick(brand: Brand, promoCode: string): Promise<void> {
  const prisma = dbFor(brand)
  const code = normalizeCode(promoCode)
  const affiliate = await prisma.affiliate.findUnique({
    where: { promoCode: code },
    select: { id: true, status: true },
  })
  if (!affiliate || affiliate.status !== 'approved') return

  await prisma.affiliateEvent.create({
    data: { affiliateId: affiliate.id, type: 'click' },
  })
}

/**
 * Resolve `promoCode` to the approved creator it belongs to, so the caller can
 * stamp `order.affiliateId`. Null for an unknown, pending or suspended code.
 *
 * ATTRIBUTION ONLY. It used to take `orderId` and `subtotal` as well and write
 * the commission event itself — at placement, on a still-unpaid order, with no
 * reversal anywhere. Those two parameters are gone rather than ignored, so a
 * future caller cannot pass them and expect money to move: the payable is
 * `bookOrderCommission`, below, called from `markOrderPaid`.
 *
 * Accepts an optional transaction client so checkout can resolve this inside
 * the same atomic transaction that creates the order.
 */
export async function attributeOrder(
  brand: Brand,
  promoCode: string,
  db: Db = dbFor(brand),
): Promise<string | null> {
  const code = normalizeCode(promoCode)
  const affiliate = await db.affiliate.findUnique({
    where: { promoCode: code },
    select: { id: true, status: true },
  })
  if (!affiliate || affiliate.status !== 'approved') return null
  return affiliate.id
}

/**
 * Book the creator's commission for an order that has just been PAID.
 *
 * ── Why this is not done at placement ───────────────────────────────────────
 * `attributeOrder` used to create the `AffiliateEvent` itself, inside
 * `placeOrder`'s transaction — on an order written `status: 'pending'`, before
 * the gateway had been opened, let alone captured. Nothing ever reversed it:
 * `reconcilePendingOrders` cancels an abandoned order and restores its stock,
 * coupon and payment without touching the event; `refundOrder` reverses points,
 * stock, coupon and both Thara ledgers and not this; and `placeOrder`'s
 * gateway-failure path DELETES the order, while the FK is `onDelete: SetNull`,
 * so the payable outlived the order entirely.
 *
 * Every earnings read is an unfiltered `sum(commission)` with no join to the
 * order's status, and the console prints that number in the column an operator
 * pays out from. So a creator accrued 10% of every basket that merely reached
 * the order table — including every shopper who opened the payment window and
 * closed it again.
 *
 * The file's own loyalty comment, two lines above the old call site, already
 * stated the rule this now follows: points "are NOT awarded here. The order is
 * only 'pending' at this point; the Bloom points award now lives in
 * markOrderPaid so it's granted exactly once, when (and only when) the order
 * actually becomes 'paid'." Commission is the same kind of promise and now
 * lives in the same place.
 *
 * Idempotent on `(orderId, type)`. `markOrderPaid` already claims the
 * pending→paid transition with a compare-and-set so only one transaction runs
 * these side effects, but this also has to be safe for an order PLACED before
 * this change (which already carries a placement-time event) and paid after it.
 */
export async function bookOrderCommission(brand: Brand, db: Db, orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { affiliateId: true, subtotal: true },
  })
  if (!order?.affiliateId) return

  const existing = await db.affiliateEvent.findFirst({
    where: { orderId, type: 'order' },
    select: { id: true },
  })
  if (existing) return

  const commission = Math.round(order.subtotal * COMMISSION_RATE)
  await db.affiliateEvent.create({
    data: {
      affiliateId: order.affiliateId,
      type: 'order',
      orderId,
      amount: order.subtotal,
      commission,
    },
  })
}

/**
 * Reverse a booked commission when the order is refunded.
 *
 * A mirror-signed row rather than a delete, so the ledger still shows what
 * happened — the same shape `reverseTharaPointsForRefund` uses. The earnings
 * aggregates sum `commission`, so a negative row nets the payable back to zero
 * without any read having to learn about order statuses.
 */
export async function reverseOrderCommission(db: Db, orderId: string): Promise<void> {
  const booked = await db.affiliateEvent.findFirst({
    where: { orderId, type: 'order' },
    select: { affiliateId: true, amount: true, commission: true },
  })
  if (!booked || booked.commission <= 0) return

  const alreadyReversed = await db.affiliateEvent.findFirst({
    where: { orderId, type: 'order', commission: { lt: 0 } },
    select: { id: true },
  })
  if (alreadyReversed) return

  await db.affiliateEvent.create({
    data: {
      affiliateId: booked.affiliateId,
      type: 'order',
      orderId,
      amount: -booked.amount,
      commission: -booked.commission,
    },
  })
}

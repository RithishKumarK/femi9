import 'server-only'
import { Prisma } from '@prisma/client'
import type { SubscriptionStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { orderPrefix } from '../brands'
import { logger } from '../logger'
import * as razorpay from '../razorpay'
import { mockProvidersAllowed } from '../runtime-mode'
import { markOrderPaid, shippingForWeight } from './checkout'
import { applyZonePrice, resolveZone, type ResolvedZone } from './pricing'
import { getSettings } from './settings'
import { resolvePlanId } from './subscription-plans'

/**
 * Subscriptions service — per-user recurring boxes, billed by a RAZORPAY MANDATE.
 *
 * ── Who owns the calendar ─────────────────────────────────────────────────────
 * The gateway does. A subscription here is the local mirror of a Razorpay
 * Subscription: the customer authorises a mandate once (UPI Autopay, a card
 * mandate or e-NACH), and from then on RAZORPAY decides when to debit, retries a
 * failed debit on its own schedule, and tells us what happened over the
 * `subscription.*` webhooks. We do not generate the charge and we cannot move
 * the date; `nextDeliveryAt` is re-synced FROM the gateway's `current_end`
 * rather than computed, because our arithmetic would only ever be a guess at it.
 *
 * Orders are therefore created by `recordSubscriptionCharge`, from the webhook,
 * AFTER the money has arrived — the order is born paid. This is the whole point
 * of the change: the previous design generated a `pending` order from cron that
 * had no Payment row, could not be paid online, and that nobody was ever asked
 * to pay.
 *
 * ── Two kinds of row, and the discriminator ──────────────────────────────────
 * `razorpaySubscriptionId != null`  → GATEWAY-MANAGED (everything above).
 * `razorpaySubscriptionId == null`  → LEGACY pay-later, from before mandates.
 *                                     `generateDueOrders` still serves these and
 *                                     only these, so the plans already live when
 *                                     this shipped keep behaving as they did
 *                                     instead of silently stopping.
 *
 * Ownership: every customer-facing mutation is scoped by { id, userId }, so one
 * shopper can never touch another's plan. `adminCancel` is the one exception —
 * the console's cancel button, scoped by brand alone because the caller is not
 * a customer.
 */

// Flat courier fee below the free-shipping threshold, for a plan whose variant
// carries no `weightKg`. Mirrors checkout.SHIPPING_FEE (that constant isn't
// exported); kept here so renewal totals match a normal order.
const SHIPPING_FEE = 49

/**
 * How many cycles a mandate is authorised for.
 *
 * Razorpay requires a finite `total_count` — there is no "until cancelled" — so
 * an open-ended refill plan asks for roughly five years of cycles and relies on
 * cancellation, not expiry, to end. Asking for the maximum instead would put an
 * alarming number on the customer's mandate approval screen ("up to 1825
 * debits"), and asking for a small number would silently stop her deliveries on
 * an arbitrary anniversary.
 */
const MANDATE_YEARS = 5

function mandateTotalCount(cadenceDays: number): number {
  return Math.max(1, Math.ceil((MANDATE_YEARS * 365) / cadenceDays))
}

/** Cadence code (cycle/4w/6w) didn't resolve to a Cadence row. Route → 400. */
export class CadenceNotFoundError extends Error {
  constructor(code: string) {
    super(`Unknown cadence: ${code}`)
    this.name = 'CadenceNotFoundError'
  }
}

/** The chosen variant no longer exists. Route → 400 (stale product option). */
export class VariantNotFoundError extends Error {
  constructor(id: string) {
    super(`Variant not found: ${id}`)
    this.name = 'VariantNotFoundError'
  }
}

/** A renewal can't be fulfilled because the variant is out of stock. Internal —
 *  generateDueOrders catches it, leaves the sub due, and moves on. Note this is
 *  a LEGACY-path error only: once money has been taken under a mandate, a stock
 *  shortfall can never refuse the order (see recordSubscriptionCharge). */
class RenewalOutOfStockError extends Error {
  constructor(itemName: string) {
    super(`Out of stock: ${itemName}`)
    this.name = 'RenewalOutOfStockError'
  }
}

// ── View model (serializable; what the API returns + Account.tsx reflects) ─────

export interface SubscriptionView {
  id: string
  product: string
  variantLabel: string
  qty: number
  cadenceCode: string
  frequency: string // cadence.label, e.g. "Every 4 weeks"
  nextDelivery: string // "18 Jun 2026" — matches the account read model's format
  /**
   * The same date as an ISO day, for arithmetic.
   *
   * `nextDelivery` is a DISPLAY string and reading it as one was a real bug:
   * the parenting dashboard did `nextDelivery.slice(0, 10)`, which turns
   * "18 Jun 2026" into "18 Jun 20", and told every subscriber their next box
   * "ships in about 0 days" — forever, on a card whose whole purpose is that
   * number. The `Date.parse` guard in front of it passed, because the FULL
   * string parses fine; only the slice was nonsense.
   *
   * A formatted date and a computable one are different things, so the DTO
   * carries both rather than asking every consumer to re-derive one from the
   * other and get the locale wrong.
   */
  nextDeliveryOn: string // "2026-06-18"
  status: SubscriptionStatus
  saved: number // savedTotal, rupees
  /** Rupees the mandate debits each cycle. Null on a legacy pay-later plan,
   *  where no fixed amount was ever agreed. */
  chargeAmount: number | null
  /** True once the customer's bank/UPI app has approved the mandate. */
  mandateActive: boolean
  /**
   * This plan has a gateway mandate that was never authorised — and therefore
   * an authorisation the account page can re-open.
   *
   * NOT the same as `!mandateActive`, and the difference is a bug waiting to
   * happen: a LEGACY pay-later plan also has no mandate, but it has no gateway
   * subscription either, so `authorizationFor` returns null and a "Set up
   * auto-pay" button rendered from `!mandateActive` would 404 on every one of
   * the plans that existed before mandates shipped. The UIs render the CTA from
   * THIS flag.
   */
  needsMandate: boolean
}

/**
 * What the browser needs to open Razorpay Checkout in mandate-authorisation
 * mode. Returned by `createSubscription` and by the resume-authorisation route.
 */
export interface MandateAuthorization {
  subscriptionId: string // ours
  razorpaySubscriptionId: string
  keyId: string
  amount: number // rupees per cycle, for the confirmation copy
  /** False in mock mode (no gateway configured) — the client then posts the
   *  explicit mock confirmation instead of opening a sheet that cannot exist. */
  configured: boolean
}

// Relations every view/renewal needs: the product name + variant scalars (price,
// stock, label come free with `variant`) and the cadence (code/label/days).
const subInclude = {
  variant: { include: { product: { select: { name: true } } } },
  cadence: true,
} satisfies Prisma.SubscriptionInclude

type SubRow = Prisma.SubscriptionGetPayload<{ include: typeof subInclude }>

// ── Formatting helpers ─────────────────────────────────────────────────────────

// Built from parts so the output is a guaranteed "18 Jun 2026" regardless of the
// locale's default separators — identical to services/account.ts so the two
// subscription surfaces read the same date the same way.
const DMY = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
function fmtDate(d: Date): string {
  const parts = DMY.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}`
}

/**
 * The local calendar day as `YYYY-MM-DD`.
 *
 * Not `toISOString().slice(0,10)`: that is UTC, and a delivery at 00:30 IST
 * reads as the previous day for every Indian customer — which on a "ships in N
 * days" counter is an off-by-one on the number the card exists to show.
 */
function isoDay(d: Date): string {
  const parts = DMY_ISO.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const DMY_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** now + n days. Cadence intervals are whole days, so plain ms arithmetic is exact. */
function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000)
}

function toView(s: SubRow): SubscriptionView {
  return {
    id: s.id,
    product: s.variant.product.name,
    variantLabel: s.variant.label,
    qty: s.qty,
    cadenceCode: s.cadence.code,
    frequency: s.cadence.label,
    nextDelivery: fmtDate(s.nextDeliveryAt),
    nextDeliveryOn: isoDay(s.nextDeliveryAt),
    status: s.status,
    saved: s.savedTotal,
    chargeAmount: s.chargeAmount,
    mandateActive: s.mandateAuthedAt != null,
    needsMandate: s.razorpaySubscriptionId != null && s.mandateAuthedAt == null,
  }
}

// ── Pricing one cycle ──────────────────────────────────────────────────────────

export interface CycleQuote {
  /** Catalogue (zone-adjusted) price of one unit, before the subscribe saving. */
  fullUnit: number
  subtotal: number
  discount: number
  shipping: number
  total: number
}

/**
 * What one delivery of this plan costs.
 *
 * The two discounts compose in a fixed order — region first, then subscribe — so
 * `subtotal` is the regional shelf price and `discount` stays exactly the
 * subscribe saving the customer was promised.
 *
 * Used in two places that MUST agree: at signup, to fix the mandate amount, and
 * at charge time, to write the order's line breakdown. Sharing one function is
 * the only thing keeping the number on the mandate screen and the number on the
 * invoice from drifting apart.
 */
export function quoteCycle({
  unitPrice,
  qty,
  zone,
  variantId,
  subscribeSavePct,
  freeShipThreshold,
  weightKg,
}: {
  unitPrice: number
  qty: number
  zone: ResolvedZone | null
  variantId: string
  subscribeSavePct: number
  freeShipThreshold: number
  /** `ProductVariant.weightKg` of the subscribed pack — null for a variant
   *  seeded before that column existed, in which case shipping falls back to
   *  the flat `SHIPPING_FEE` rather than pricing an unweighed box. */
  weightKg: number | null
}): CycleQuote {
  const fullUnit = applyZonePrice(unitPrice, zone, { variantId })
  const discountedUnit = Math.round((fullUnit * (100 - subscribeSavePct)) / 100)
  const subtotal = fullUnit * qty
  const discount = (fullUnit - discountedUnit) * qty
  const discountedSubtotal = subtotal - discount
  const shipping =
    discountedSubtotal >= freeShipThreshold
      ? 0
      : weightKg !== null
        ? shippingForWeight(weightKg * qty)
        : SHIPPING_FEE
  return { fullUnit, subtotal, discount, shipping, total: discountedSubtotal + shipping }
}

/** The customer's delivery address — the regional-pricing signal AND where the
 *  box goes. Read the primary one, falling back to whichever exists. */
async function primaryAddress(brand: Brand, userId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? dbFor(brand)
  return db.address.findFirst({
    where: { userId, archivedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    select: { id: true, state: true, pincode: true },
  })
}

// ── Customer reads/writes (all ownership-checked) ───────────────────────────────

export interface CreateSubscriptionInput {
  variantId: string
  qty: number
  cadenceCode: string
}

export interface CreateSubscriptionResult {
  subscription: SubscriptionView
  authorization: MandateAuthorization
}

/**
 * Start a subscription for `userId`.
 *
 * Two-phase, and it has to be: the row is written `pending_mandate` and NOTHING
 * recurs until the customer completes Razorpay Checkout and her bank approves
 * the mandate. The returned `authorization` is what the browser needs to open
 * that sheet.
 *
 * The charge amount is FIXED here, for the life of the mandate — Razorpay plans
 * are immutable and an authorised mandate cannot be re-priced. A catalogue price
 * change, or the customer later adding an address in a differently-priced zone,
 * does NOT move it; that is a property of gateway-managed billing, not an
 * oversight. `recordSubscriptionCharge` reconciles the difference at order time
 * and books what the bank actually took.
 */
export async function createSubscription(
  brand: Brand,
  userId: string,
  input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> {
  const prisma = dbFor(brand)
  const cadence = await prisma.cadence.findUnique({ where: { code: input.cadenceCode } })
  if (!cadence) throw new CadenceNotFoundError(input.cadenceCode)

  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    include: { product: { select: { name: true } } },
  })
  if (!variant) throw new VariantNotFoundError(input.variantId)

  const qty = Math.max(1, Math.floor(input.qty) || 1)
  const { subscribeSavePct, freeShipThreshold } = await getSettings(brand)

  const address = await primaryAddress(brand, userId)
  const zone = address
    ? await resolveZone(brand, { state: address.state, pincode: address.pincode })
    : null
  const quote = quoteCycle({
    unitPrice: variant.price,
    qty,
    zone,
    variantId: variant.id,
    subscribeSavePct,
    freeShipThreshold,
    weightKg: variant.weightKg,
  })

  // Plan first: it is idempotent per (amount, rhythm) and creating it cannot
  // affect anything if the steps after it fail.
  const planId = await resolvePlanId(brand, {
    days: cadence.days,
    amountRupees: quote.total,
    label: cadence.label,
  })

  // Then our row, still unauthorised, so a gateway failure below leaves a plan
  // the customer can retry rather than an orphaned mandate we never recorded.
  const sub = await prisma.subscription.create({
    data: {
      userId,
      variantId: variant.id,
      qty,
      cadenceId: cadence.id,
      status: 'pending_mandate',
      // Provisional: replaced by the gateway's own `current_end` on the first
      // charge. Until then it is what the account page shows, and one cadence
      // out is the honest estimate.
      nextDeliveryAt: addDays(new Date(), cadence.days),
      savedTotal: 0,
      chargeAmount: quote.total,
      razorpayPlanId: planId,
    },
    include: subInclude,
  })

  // A gateway failure here would otherwise strand the row written above: it has
  // no `razorpaySubscriptionId`, so `authorizationFor` cannot offer to finish it
  // AND it is indistinguishable from a legacy pay-later plan. Delete it, so the
  // shopper simply retries rather than accumulating dead plans on her account.
  let gateway: Awaited<ReturnType<typeof razorpay.createSubscription>>
  try {
    gateway = await razorpay.createSubscription(brand, {
      planId,
      totalCount: mandateTotalCount(cadence.days),
      notes: { brand, subscriptionId: sub.id, userId },
    })
  } catch (err) {
    await prisma.subscription.delete({ where: { id: sub.id } }).catch(() => {})
    throw err
  }

  const linked = await prisma.subscription.update({
    where: { id: sub.id },
    data: { razorpaySubscriptionId: gateway.id, gatewayStatus: gateway.status },
    include: subInclude,
  })

  return {
    subscription: toView(linked),
    authorization: {
      subscriptionId: linked.id,
      razorpaySubscriptionId: gateway.id,
      keyId: razorpay.publicKeyId(brand),
      amount: quote.total,
      configured: razorpay.isConfigured(brand),
    },
  }
}

/** Every subscription for the signed-in customer, newest first. */
export async function listForUser(brand: Brand, userId: string): Promise<SubscriptionView[]> {
  const prisma = dbFor(brand)
  const subs = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: subInclude,
  })
  return subs.map(toView)
}

/** Re-read a subscription scoped to its owner → view, or null (not owned/gone). */
async function ownedView(brand: Brand, id: string, userId: string): Promise<SubscriptionView | null> {
  const prisma = dbFor(brand)
  const sub = await prisma.subscription.findFirst({ where: { id, userId }, include: subInclude })
  return sub ? toView(sub) : null
}

/** Same read, without the ownership scope — for the console, which is not the
 *  customer and has no `userId` to filter by. Brand isolation (`dbFor(brand)`)
 *  is what stands in its place. */
async function viewById(brand: Brand, id: string): Promise<SubscriptionView | null> {
  const prisma = dbFor(brand)
  const sub = await prisma.subscription.findFirst({ where: { id }, include: subInclude })
  return sub ? toView(sub) : null
}

/**
 * Re-open the authorisation sheet for a plan whose mandate was never completed.
 *
 * A shopper who closes Checkout leaves a `pending_mandate` row and a Razorpay
 * subscription at status `created`. Both are still perfectly good — the mandate
 * simply has not been approved — so finishing it reuses them rather than
 * creating a second plan she would then be billed for twice.
 */
export async function authorizationFor(
  brand: Brand,
  id: string,
  userId: string,
): Promise<MandateAuthorization | null> {
  const prisma = dbFor(brand)
  const sub = await prisma.subscription.findFirst({ where: { id, userId } })
  if (!sub?.razorpaySubscriptionId || sub.chargeAmount == null) return null
  if (sub.status === 'cancelled') return null
  return {
    subscriptionId: sub.id,
    razorpaySubscriptionId: sub.razorpaySubscriptionId,
    keyId: razorpay.publicKeyId(brand),
    amount: sub.chargeAmount,
    configured: razorpay.isConfigured(brand),
  }
}

/**
 * Mark a mandate authorised — the customer's bank approved it.
 *
 * Called from the synchronous Checkout return (after signature verification) and
 * again from the `subscription.authenticated` / `subscription.activated`
 * webhooks. Both paths race, so this is written to be idempotent: the update is
 * scoped to a row that is still `pending_mandate`, and a second call is a no-op
 * that simply re-reads.
 */
export async function confirmMandate(
  brand: Brand,
  razorpaySubscriptionId: string,
  gatewayStatus?: string,
): Promise<void> {
  const prisma = dbFor(brand)
  const res = await prisma.subscription.updateMany({
    where: { razorpaySubscriptionId, status: 'pending_mandate' },
    data: {
      status: 'active',
      mandateAuthedAt: new Date(),
      ...(gatewayStatus ? { gatewayStatus } : {}),
    },
  })
  if (res.count === 0 && gatewayStatus) {
    // Already authorised (or cancelled since) — still record the gateway's word
    // on it so support sees the live status.
    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId },
      data: { gatewayStatus },
    })
  }
}

/**
 * Project a Razorpay status onto ours, for the webhooks that only report a state
 * change. Returns null for `created`, which is pre-authorisation and must never
 * move a row: it is the state a subscription sits in before the customer has
 * approved anything.
 */
function localStatusFor(gatewayStatus: string): SubscriptionStatus | null {
  switch (gatewayStatus) {
    case 'active':
      return 'active'
    case 'paused':
      return 'paused'
    case 'halted':
      return 'halted'
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'cancelled'
    default:
      return null
  }
}

/**
 * Apply a `subscription.*` state change from the webhook.
 *
 * The gateway is authoritative here: if Razorpay says halted, the plan is
 * halted, whatever our row believed. A customer revoking her mandate directly in
 * her banking app never touches our UI, and this is the only way we hear about
 * it — without it the plan would sit `active` forever while every debit failed.
 */
export async function syncGatewayStatus(
  brand: Brand,
  razorpaySubscriptionId: string,
  gatewayStatus: string,
  currentEnd?: Date | null,
): Promise<void> {
  const prisma = dbFor(brand)
  const status = localStatusFor(gatewayStatus)

  // A row still awaiting its mandate that the gateway now calls active was
  // authorised somewhere we did not see (the customer completed Checkout and
  // closed the tab before our confirm call landed). It must go through
  // `confirmMandate`, which is the only writer of `mandateAuthedAt` — flipping
  // it to active here would leave a live plan that the account page still
  // renders as "finish authorising".
  if (status === 'active') {
    await confirmMandate(brand, razorpaySubscriptionId, gatewayStatus)
  }

  await prisma.subscription.updateMany({
    where: {
      razorpaySubscriptionId,
      // Never let a non-terminal gateway status resurrect a row the customer
      // has not authorised; `cancelled` is allowed through because a mandate
      // abandoned at the gateway should close here too.
      ...(status && status !== 'cancelled' ? { status: { not: 'pending_mandate' } } : {}),
    },
    data: {
      gatewayStatus,
      ...(status && status !== 'active' ? { status } : {}),
      ...(currentEnd ? { currentEnd, nextDeliveryAt: currentEnd } : {}),
      // A cancelled/halted plan must not be woken up later by the skip cron.
      ...(status === 'cancelled' || status === 'halted' ? { resumeAt: null } : {}),
    },
  })
}

/**
 * Flip status and tell the gateway. The shared core of every mutation below,
 * including the console's — `where` is the ownership guard for a customer
 * ({ id, userId }) or the brand-only scope for admin ({ id }), and it is used
 * for BOTH the lookup and the update, so nothing between them can drift.
 *
 * The gateway call goes FIRST and a failure aborts: a local row that says
 * "paused" over a mandate that is still debiting is the worst of the available
 * wrong answers, because whoever asked for the change sees the state they
 * wanted and the customer is charged anyway. Better to fail the request and
 * let it be retried.
 *
 * `updateMany`'s `where` is checked BEFORE the gateway call (count 0 ⇒ not
 * found under this scope ⇒ null) so a request for a subscription outside it —
 * someone else's plan, from a customer route — cannot reach Razorpay at all,
 * and a caller can never learn whether an out-of-scope id exists.
 */
async function applyStatus(
  brand: Brand,
  where: Prisma.SubscriptionWhereInput,
  status: SubscriptionStatus,
  gatewayCall: (razorpaySubscriptionId: string) => Promise<unknown>,
  extra: Prisma.SubscriptionUpdateManyMutationInput = {},
): Promise<boolean> {
  const prisma = dbFor(brand)
  const sub = await prisma.subscription.findFirst({ where })
  if (!sub) return false

  // Pausing, resuming or skipping a mandate the customer's bank never approved
  // is meaningless, and asking Razorpay to do it fails with a gateway error that
  // reads like an outage. The storefront hides these controls on such a plan;
  // this is the guard that does not depend on the storefront being right.
  // Cancelling is the exception — abandoning an unauthorised plan must work.
  if (sub.razorpaySubscriptionId && !sub.mandateAuthedAt && status !== 'cancelled') {
    return false
  }

  if (sub.razorpaySubscriptionId) {
    await gatewayCall(sub.razorpaySubscriptionId)
  }

  const res = await prisma.subscription.updateMany({ where, data: { status, ...extra } })
  return res.count > 0
}

async function setStatus(
  brand: Brand,
  id: string,
  userId: string,
  status: SubscriptionStatus,
  gatewayCall: (razorpaySubscriptionId: string) => Promise<unknown>,
  extra: Prisma.SubscriptionUpdateManyMutationInput = {},
): Promise<SubscriptionView | null> {
  const applied = await applyStatus(brand, { id, userId }, status, gatewayCall, extra)
  if (!applied) return null
  return ownedView(brand, id, userId)
}

export function pause(brand: Brand, id: string, userId: string): Promise<SubscriptionView | null> {
  return setStatus(brand, id, userId, 'paused', (rzpId) => razorpay.pauseSubscription(brand, rzpId), {
    // A manual pause is open-ended, so it must clear any pending skip-resume —
    // otherwise the cron un-pauses a plan the customer deliberately stopped.
    resumeAt: null,
  })
}

export function resume(brand: Brand, id: string, userId: string): Promise<SubscriptionView | null> {
  return setStatus(brand, id, userId, 'active', (rzpId) => razorpay.resumeSubscription(brand, rzpId), {
    resumeAt: null,
  })
}

export function cancel(brand: Brand, id: string, userId: string): Promise<SubscriptionView | null> {
  return setStatus(
    brand,
    id,
    userId,
    'cancelled',
    (rzpId) => razorpay.cancelSubscription(brand, rzpId, false),
    { resumeAt: null },
  )
}

/**
 * Cancel a subscription from the CONSOLE — the one mutation in this file that
 * is not scoped to a customer's own `userId`, because the caller is not the
 * customer. Ops reaches for this when she rang support instead of using her
 * account page, when a mandate is stuck in a state the storefront's own
 * cancel button cannot reach, or when continuing to bill her is the wrong
 * outcome regardless of what anyone asked for.
 *
 * Scoped by `{ id }` under `dbFor(brand)` — brand isolation is what replaces
 * the ownership check; there is no second user to guard against here. Same
 * gateway-first ordering and the same pending-mandate exception as the
 * customer path (`cancel`, above), because the failure mode is identical: a
 * local row that says cancelled over a mandate still live at Razorpay is the
 * worst available wrong answer, whoever asked for it.
 */
export async function adminCancel(brand: Brand, id: string): Promise<SubscriptionView | null> {
  const applied = await applyStatus(
    brand,
    { id },
    'cancelled',
    (rzpId) => razorpay.cancelSubscription(brand, rzpId, false),
    { resumeAt: null },
  )
  if (!applied) return null
  return viewById(brand, id)
}

/**
 * Skip the next delivery.
 *
 * Razorpay has **no skip-one-cycle primitive**, so on a gateway-managed plan a
 * skip is a pause now plus a resume scheduled one cadence out, which
 * `resumeDueSkips` (the resume-subscriptions cron) performs. The customer sees
 * one delivery missed and billing resumes after it; that is the closest thing
 * the Subscriptions API can express.
 *
 * The consequence worth knowing: the exact date of the debit AFTER a skip is
 * decided by Razorpay when it resumes, not by us. `nextDeliveryAt` is advanced
 * here so the account page says something honest in the meantime, and is
 * corrected to the gateway's own `current_end` on the next charge.
 *
 * A LEGACY plan keeps the old behaviour — push `nextDeliveryAt` out by one
 * interval — because there is no mandate to pause.
 */
export async function skipNext(
  brand: Brand,
  id: string,
  userId: string,
): Promise<SubscriptionView | null> {
  const prisma = dbFor(brand)
  const sub = await prisma.subscription.findFirst({
    where: { id, userId },
    include: { cadence: true },
  })
  if (!sub) return null

  // Same guard as `setStatus`, and it must be repeated here because skipNext
  // does not route through it: pausing a mandate the customer's bank never
  // approved fails at the gateway with an error that reads like an outage.
  if (sub.razorpaySubscriptionId && !sub.mandateAuthedAt) return null

  const skipUntil = addDays(
    sub.nextDeliveryAt > new Date() ? sub.nextDeliveryAt : new Date(),
    sub.cadence.days,
  )

  if (sub.razorpaySubscriptionId) {
    await razorpay.pauseSubscription(brand, sub.razorpaySubscriptionId)
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'paused', resumeAt: skipUntil, nextDeliveryAt: skipUntil },
    })
  } else {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { nextDeliveryAt: addDays(sub.nextDeliveryAt, sub.cadence.days) },
    })
  }
  return ownedView(brand, id, userId)
}

/**
 * Resume every plan whose skipped cycle has now passed. Driven by
 * `/api/cron/resume-subscriptions`.
 *
 * Only rows that are BOTH `paused` and carry a `resumeAt` are touched, so a
 * customer who paused indefinitely (no `resumeAt`) is never woken up. Failures
 * are isolated per subscription: one plan whose mandate the gateway refuses to
 * resume must not strand every other skip behind it.
 */
export async function resumeDueSkips(brand: Brand): Promise<number> {
  const prisma = dbFor(brand)
  const due = await prisma.subscription.findMany({
    where: { status: 'paused', resumeAt: { not: null, lte: new Date() } },
    select: { id: true, razorpaySubscriptionId: true },
  })

  let resumed = 0
  for (const sub of due) {
    try {
      if (sub.razorpaySubscriptionId) {
        await razorpay.resumeSubscription(brand, sub.razorpaySubscriptionId)
      }
      // Clear `resumeAt` in the same write that reactivates, and scope it to a
      // still-paused row so a concurrent manual resume/cancel wins rather than
      // being overwritten by the cron.
      const res = await prisma.subscription.updateMany({
        where: { id: sub.id, status: 'paused' },
        data: { status: 'active', resumeAt: null },
      })
      resumed += res.count
    } catch (err) {
      logger.error('[subscriptions] resume failed', { subscriptionId: sub.id, err })
    }
  }
  return resumed
}

// ── The money path: a gateway charge becomes a paid order ──────────────────────

/**
 * Next sequential order number for THIS BRAND, continuing past its current max.
 * Mirrors checkout's generator so a renewal shares the numbering space of the
 * orders placed beside it.
 *
 * The prefix is `orderPrefix(brand)`, not the literal 'FM-' this used to hard
 * code. That literal is Femi9's, and this function runs against whichever schema
 * `dbFor(brand)` opened — so a Lumi9 renewal was numbered FM-00001 inside the
 * `lumi9` schema: a customer-facing number, printed on her receipt and read back
 * to support, belonging to the other brand.
 *
 * It also counted the wrong sequence. The `startsWith` found no FM- rows among
 * Lumi9's LM- orders, so renewals numbered themselves from 00001 upwards in
 * parallel with the real orders beside them, and the same digits appeared on two
 * different orders in one schema.
 */
async function nextOrderNo(tx: Prisma.TransactionClient, brand: Brand): Promise<string> {
  const prefix = orderPrefix(brand) + '-'
  const last = await tx.order.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  })
  const lastNum = last ? Number.parseInt(last.orderNo.slice(prefix.length), 10) : 0
  const nextNum = (Number.isFinite(lastNum) ? lastNum : 0) + 1
  return prefix + String(nextNum).padStart(5, '0')
}

/** True when a write hit a unique-constraint violation (e.g. two concurrent
 *  renewals derived the same orderNo). Retryable. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export interface SubscriptionChargeInput {
  razorpaySubscriptionId: string
  razorpayPaymentId: string
  /** The gateway order the debit was raised against. Razorpay creates one per
   *  cycle; it is what `markOrderPaid` matches the Payment row on. */
  razorpayOrderId: string
  amountPaise: number
  method?: string
  currentEnd?: Date | null
}

export interface SubscriptionChargeResult {
  orderNo: string
  alreadyRecorded: boolean
}

/**
 * Record one successful mandate debit as a PAID order. This is the money path.
 *
 * Called from the `subscription.charged` webhook, so by the time we are here the
 * bank has already moved the money. Everything below is therefore written to
 * NEVER refuse the order:
 *
 *  - A stock shortfall does not abort. Refusing would mean money taken and
 *    nothing recorded; instead the order is created, stock is floored at zero,
 *    and the shortfall is logged loudly for ops to source. This is the exact
 *    opposite of the legacy cron's behaviour, and correctly so — that path could
 *    refuse because nothing had been charged yet.
 *  - The order's `total` is always what the gateway actually took. If the
 *    catalogue has moved since the mandate was authorised, the recomputed quote
 *    disagrees; we keep the quote's line breakdown and let `discount` absorb the
 *    difference, because `markOrderPaid` requires payment.amount === order.total
 *    and because booking a number the bank did not take is worse than an
 *    imprecise discount line.
 *
 * Idempotent on `razorpayPaymentId`: Razorpay re-delivers webhooks, and the
 * unique index on Payment is the backstop if two deliveries race.
 */
export async function recordSubscriptionCharge(
  brand: Brand,
  input: SubscriptionChargeInput,
): Promise<SubscriptionChargeResult | null> {
  const prisma = dbFor(brand)

  const sub = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: input.razorpaySubscriptionId },
    include: subInclude,
  })
  if (!sub) {
    logger.error('[subscriptions] charge for unknown subscription', {
      razorpaySubscriptionId: input.razorpaySubscriptionId,
    })
    return null
  }

  // Idempotency: this exact payment already produced an order.
  const seen = await prisma.payment.findUnique({
    where: { razorpayPaymentId: input.razorpayPaymentId },
    select: { order: { select: { orderNo: true } } },
  })
  if (seen) return { orderNo: seen.order.orderNo, alreadyRecorded: true }

  const charged = Math.round(input.amountPaise / 100)
  const { subscribeSavePct, freeShipThreshold } = await getSettings(brand)

  const address = await primaryAddress(brand, sub.userId)
  const zone = address
    ? await resolveZone(brand, { state: address.state, pincode: address.pincode })
    : null
  const quote = quoteCycle({
    unitPrice: sub.variant.price,
    qty: sub.qty,
    zone,
    variantId: sub.variantId,
    subscribeSavePct,
    freeShipThreshold,
    weightKg: sub.variant.weightKg,
  })

  if (quote.total !== charged) {
    logger.warn('[subscriptions] charge differs from current quote — booking the charge', {
      subscriptionId: sub.id,
      charged,
      quoted: quote.total,
    })
  }
  // total is ALWAYS the charged amount; discount absorbs any drift.
  const discount = quote.subtotal + quote.shipping - charged

  const MAX_ATTEMPTS = 5
  let orderNo = ''
  for (let attempt = 1; ; attempt++) {
    try {
      orderNo = await prisma.$transaction(async (tx) => {
        const no = await nextOrderNo(tx, brand)
        const order = await tx.order.create({
          data: {
            orderNo: no,
            userId: sub.userId,
            subscriptionId: sub.id,
            addressId: address?.id ?? null,
            status: 'pending', // flipped to paid by markOrderPaid below
            channel: 'web',
            subtotal: quote.subtotal,
            discount,
            shipping: quote.shipping,
            total: charged,
            items: {
              create: [
                {
                  variantId: sub.variantId,
                  productName: sub.variant.product.name,
                  variantLabel: sub.variant.label,
                  unitPrice: quote.fullUnit,
                  qty: sub.qty,
                  lineTotal: quote.subtotal,
                },
              ],
            },
          },
        })

        // The Payment row markOrderPaid requires. Created inside the same
        // transaction as the order so an order can never exist without one.
        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: 'razorpay',
            razorpayOrderId: input.razorpayOrderId,
            amount: charged,
            status: 'created',
            method: input.method,
          },
        })

        // Reserve stock, but never at the cost of the order (see the header).
        const reserved = await tx.productVariant.updateMany({
          where: { id: sub.variantId, stock: { gte: sub.qty } },
          data: { stock: { decrement: sub.qty } },
        })
        if (reserved.count === 0) {
          const current = await tx.productVariant.findUnique({
            where: { id: sub.variantId },
            select: { stock: true },
          })
          logger.error('[subscriptions] PAID renewal could not be stocked — backorder', {
            orderNo: no,
            subscriptionId: sub.id,
            wanted: sub.qty,
            available: current?.stock ?? 0,
          })
          await tx.productVariant.updateMany({
            where: { id: sub.variantId, stock: { gt: 0 } },
            data: { stock: 0 },
          })
        }

        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            savedTotal: { increment: Math.max(0, discount) },
            ...(input.currentEnd
              ? { currentEnd: input.currentEnd, nextDeliveryAt: input.currentEnd }
              : { nextDeliveryAt: addDays(new Date(), sub.cadence.days) }),
            // A charge proves the mandate is live, whatever we thought — EXCEPT
            // on a cancelled plan. A final `cancel_at_cycle_end` debit, or a
            // charge that raced the cancellation, must not resurrect a plan the
            // customer has ended; the order is still recorded (she paid for it
            // and it must ship), but the plan stays closed.
            ...(sub.status === 'cancelled' ? {} : { status: 'active', resumeAt: null }),
            ...(sub.mandateAuthedAt ? {} : { mandateAuthedAt: new Date() }),
          },
        })
        return no
      })
      break
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue
      throw err
    }
  }

  // Outside the transaction: this awards loyalty points and sends the order
  // confirmation email, and must not hold write locks while it does.
  await markOrderPaid(brand, {
    orderNo,
    razorpayPaymentId: input.razorpayPaymentId,
    razorpayOrderId: input.razorpayOrderId,
    signatureVerified: true, // the webhook's HMAC was checked before we got here
    method: input.method,
  })

  return { orderNo, alreadyRecorded: false }
}

// ── Legacy renewals (cron) ──────────────────────────────────────────────────────

/**
 * Turn one due LEGACY subscription into a pending Order. Unchanged behaviour for
 * the pay-later plans that predate mandates: the whole thing (stock re-read,
 * order write, stock decrement, cadence advance + savedTotal accrual) runs in a
 * single transaction so a mid-flight failure can never leave a half-created order
 * or a double-decremented variant. Throws RenewalOutOfStockError when the variant
 * can't cover the qty, which leaves the subscription untouched (still due) to
 * retry on a later run once restocked.
 */
async function createRenewalOrder(
  brand: Brand,
  sub: SubRow,
  subscribeSavePct: number,
  freeShipThreshold: number,
): Promise<void> {
  // Two concurrent generations (overlapping/retried cron runs) can derive the
  // same FM- orderNo — max-scan + create isn't atomic against a peer, so the
  // unique index rejects the loser with P2002. Retry the whole transaction: the
  // atomic claim below still guards against double-generating, and nextOrderNo
  // re-scans for a fresh number on the retry.
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; ; attempt++) {
    try {
      await runRenewalTxn(brand, sub, subscribeSavePct, freeShipThreshold)
      return
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue
      throw err
    }
  }
}

async function runRenewalTxn(
  brand: Brand,
  sub: SubRow,
  subscribeSavePct: number,
  freeShipThreshold: number,
): Promise<void> {
  const prisma = dbFor(brand)
  await prisma.$transaction(async (tx) => {
    // ── CLAIM ──────────────────────────────────────────────────────────────
    // Atomically claim this due subscription before generating anything. This
    // conditional advance is a compare-and-swap on the exact due instant we read:
    // the updateMany row-locks, so the first cron run to reach the row wins and
    // moves nextDeliveryAt forward; a concurrent/retried run then sees the value
    // changed (count 0) and bails — overlapping schedules can't double-generate.
    const claim = await tx.subscription.updateMany({
      where: { id: sub.id, status: 'active', nextDeliveryAt: sub.nextDeliveryAt },
      data: { nextDeliveryAt: addDays(sub.nextDeliveryAt, sub.cadence.days) },
    })
    if (claim.count === 0) return // already claimed by another run — skip

    // Re-read stock under the txn so a concurrent order can't oversell the variant.
    const variant = await tx.productVariant.findUnique({
      where: { id: sub.variantId },
      include: { product: { select: { name: true } } },
    })
    if (!variant) throw new VariantNotFoundError(sub.variantId)

    const qty = sub.qty
    const displayName = `${variant.product.name} - ${variant.label}`
    if (variant.stock < qty) throw new RenewalOutOfStockError(displayName)

    // Ship to the customer's primary address when they have one, so the renewal is
    // actionable in ops; nullable addressId keeps it valid when they don't. Read
    // BEFORE pricing: this address is also the regional-pricing signal, and a
    // renewal must be priced the same way a manual checkout to the same address
    // would be. (A renewal runs from cron, so there is no request to infer geo
    // from — the stored address is the only signal there is.)
    const address = await tx.address.findFirst({
      where: { userId: sub.userId },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      select: { id: true, state: true, pincode: true },
    })
    const zone = address
      ? await resolveZone(brand, { state: address.state, pincode: address.pincode }, tx)
      : null

    const quote = quoteCycle({
      unitPrice: variant.price,
      qty,
      zone,
      variantId: variant.id,
      subscribeSavePct,
      freeShipThreshold,
      weightKg: variant.weightKg,
    })

    const orderNo = await nextOrderNo(tx, brand)

    await tx.order.create({
      data: {
        orderNo,
        userId: sub.userId,
        subscriptionId: sub.id,
        addressId: address?.id ?? null,
        status: 'pending', // pay-later renewal, the legacy behaviour
        channel: 'web',
        subtotal: quote.subtotal,
        discount: quote.discount,
        shipping: quote.shipping,
        total: quote.total,
        items: {
          create: [
            {
              variantId: variant.id,
              productName: variant.product.name,
              variantLabel: variant.label,
              unitPrice: quote.fullUnit,
              qty,
              lineTotal: quote.subtotal,
            },
          ],
        },
      },
    })

    // Reserve stock with an ATOMIC conditional decrement (mirrors checkout): the
    // WHERE stock>=qty guard makes the read-and-decrement a single statement, so
    // a concurrent order/renewal can't oversell the variant under READ COMMITTED.
    // count 0 ⇒ stock slipped below qty since the re-read ⇒ treat as out of stock,
    // which rolls the txn back (including the claim) and leaves the sub due.
    const reserved = await tx.productVariant.updateMany({
      where: { id: variant.id, stock: { gte: qty } },
      data: { stock: { decrement: qty } },
    })
    if (reserved.count === 0) throw new RenewalOutOfStockError(displayName)

    // nextDeliveryAt was already advanced by the CLAIM above (kept on a fixed grid
    // from the DUE date, not `now`); here we only accrue the saving so the account
    // "Saved so far" figure grows.
    await tx.subscription.update({
      where: { id: sub.id },
      data: { savedTotal: { increment: quote.discount } },
    })
  })
}

/**
 * Generate renewal orders for every due LEGACY subscription.
 *
 * `razorpaySubscriptionId: null` is the whole filter and the whole point: a
 * gateway-managed plan must NEVER be renewed from here, because Razorpay is
 * already debiting it on its own schedule and `recordSubscriptionCharge` creates
 * that order. Without this clause every mandated subscriber would get two boxes
 * a cycle — one paid, one pending — and the pending one would hold stock forever.
 *
 * Each is processed in its own transaction; one failure (e.g. out of stock) is
 * logged and skipped so it can't abort the whole batch. Returns the number of
 * orders actually created.
 *
 * In production this is invoked by AWS EventBridge Scheduler via the cron route.
 */
export async function generateDueOrders(brand: Brand): Promise<number> {
  const prisma = dbFor(brand)
  const now = new Date()
  const { subscribeSavePct, freeShipThreshold } = await getSettings(brand)

  const due = await prisma.subscription.findMany({
    where: { status: 'active', nextDeliveryAt: { lte: now }, razorpaySubscriptionId: null },
    include: subInclude,
  })

  let generated = 0
  for (const sub of due) {
    try {
      await createRenewalOrder(brand, sub, subscribeSavePct, freeShipThreshold)
      generated += 1
    } catch (err) {
      // Isolate per-subscription failures — the batch continues; the sub stays due.
      logger.error('[subscriptions] renewal failed', { subscriptionId: sub.id, err })
    }
  }
  return generated
}

/** True when the platform can create mandates at all. The storefronts branch on
 *  this to decide whether to offer a subscribe button that can actually bill. */
export function mandatesAvailable(brand: Brand): boolean {
  return razorpay.isConfigured(brand) || mockProvidersAllowed()
}

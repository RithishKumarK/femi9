import 'server-only'
import type { OrderStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { getSettings } from './settings'
import {
  attachIdentity,
  dispatchEmailVerification,
  normalizeEmail,
  normalizePhone,
} from './auth'

/**
 * Account read model — everything the storefront /account page renders for the
 * signed-in customer, resolved from real DB records keyed by userId.
 *
 * This service is presentation-shaped on purpose: it hands Account.tsx the exact
 * strings it draws (formatted dates, a composed city line, a display phone, the
 * points balance as a plain number) so the client component stays a dumb view and
 * no Date/enum ever has to cross the server→client boundary. That also keeps the
 * props serializable, which a Server Component → Client Component handoff requires.
 *
 * One rule the audit forced: RAW columns and DISPLAY strings are separate fields.
 * The old model collapsed them (`name: user.name ?? 'Femi9 member'`), and the
 * profile editor then prefilled its input with the placeholder — one OK away from
 * persisting "Femi9 member" as a real customer's name. `name`/`email`/`phone` are
 * now the nullable columns verbatim; `displayName`/`greeting`/`phoneDisplay` are
 * the presentation layer. A form binds the former, chrome binds the latter.
 */

// ── Profile completeness ─────────────────────────────────────────────────────

export type ProfileField = 'name' | 'email' | 'phone'

/**
 * Is a mobile number part of "complete"?
 *
 * `/welcome` asks for whatever signing in did not supply, and for a Google or
 * magic-link shopper that is the phone — a second screen, an OTP round trip and
 * an SMS bill standing between somebody who has just signed in and the account
 * they were trying to reach. Whether that is worth it is a deployment decision,
 * not a code one: it depends on whether the brand sends delivery SMS, and on
 * whether an OTP provider is even configured.
 *
 * Same convention as the sign-in method flags in `auth-methods.ts`: **only the
 * exact string `false` turns it off.** A typo must not quietly stop collecting
 * the column a parcel and every delivery SMS are addressed to, so anything else
 * — unset, empty, "no", "0", a stray space — leaves it required.
 *
 * Unset means REQUIRED, which is what Femi9 has always done and what its
 * identity tests assert. Lumi9 sets `REQUIRE_PROFILE_PHONE=false`.
 *
 * Read per call rather than captured at module load: the value is a deployment
 * setting, and a module-level constant would bake whichever value the process
 * happened to start with into a long-lived server — and would make it
 * un-testable without re-importing the module.
 *
 * Turning it off never LOSES a number. Checkout still asks for one and still
 * validates it, `/account` still offers the field, and a phone-OTP sign-in
 * still writes it — this only decides whether the shopper is stopped at the
 * door until she supplies one.
 */
export function profilePhoneRequired(): boolean {
  return process.env.REQUIRE_PROFILE_PHONE !== 'false'
}

/**
 * The ONE definition of "complete". /welcome, the /account and /dashboard gates,
 * /api/auth/me and the OTP verify response all read this — nothing re-implements
 * it, so the gate can never disagree with the screen it is gating.
 * Order is fixed (name, email, phone) so the onboarding step renders predictably.
 */
export function missingProfileFields(u: {
  name: string | null
  email: string | null
  phone: string | null
}): ProfileField[] {
  const missing: ProfileField[] = []
  if (!u.name?.trim()) missing.push('name')
  if (!u.email) missing.push('email')
  if (!u.phone && profilePhoneRequired()) missing.push('phone')
  return missing
}

export const isProfileComplete = (u: Parameters<typeof missingProfileFields>[0]) =>
  missingProfileFields(u).length === 0

/**
 * Cheap completeness probe for the /welcome gate — one indexed row, three
 * columns, no orders/points/subscription reads. Returns null when the id no
 * longer resolves to a user so the caller can bounce to /login.
 */
export async function getProfileStatus(brand: Brand, 
  userId: string,
): Promise<{ complete: boolean; missing: ProfileField[] } | null> {
  const prisma = dbFor(brand)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true },
  })
  if (!user) return null
  const missing = missingProfileFields(user)
  return { complete: missing.length === 0, missing }
}

// ── View models (mirror what Account.tsx draws) ──────────────────────────────

export interface AccountUser {
  id: string
  /** RAW column. `null` when unset. Feed this to a form's defaultValue — NEVER a placeholder. */
  name: string | null
  /** Identity label for chrome: trimmed name, else the literal 'Your account'. */
  displayName: string
  /** Greeting line, resolved once here: "Welcome back, Priya" | "Welcome back". */
  greeting: string
  /** Two letters, uppercase. Falls back to the email initial, then 'F9'. */
  initials: string
  /** Google avatar URL, or null. Render initials as the fallback. */
  image: string | null
  email: string | null // RAW
  emailVerified: boolean
  phone: string | null // RAW national 10-digit, e.g. "9884230571"
  /** "+91 98842 30571" — null when phone is null. Never an em-dash: a missing
   *  channel renders as an "Add your mobile" action, not as punctuation. */
  phoneDisplay: string | null
  phoneVerified: boolean
  tier: string
  since: string
  profileComplete: boolean
  missing: ProfileField[]
}

export interface AccountOrderItem {
  name: string
  qty: number
  /** The purchased variant, so "Buy again" can put the exact line back in the
   *  bag. OrderItem.variantId is a required FK, so this is never null. */
  variantId: string
}

export interface AccountOrder {
  id: string // public orderNo, e.g. "FM-00042"
  href: string // "/order/FM-00042" — resolved here so the cell is a <Link>
  date: string // "18 Jun 2026"
  items: AccountOrderItem[]
  total: number
  status: string // "Delivered" | "Paid" | …
  /** The raw enum as a string union, so the view can map to a status pill without
   *  lowercasing a display label and hoping a CSS class exists for the result. */
  statusKey: 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
}

export interface AccountAddress {
  id: string
  label: string
  name: string
  line: string
  city: string // composed "Coimbatore, Tamil Nadu 641001" line
  /** Raw parts, so the Edit form can prefill without re-parsing the composed line. */
  cityRaw: string
  state: string
  pincode: string
  phone: string
  primary: boolean
}

/**
 * Mirrors the `SubscriptionStatus` enum. `pending_mandate` and `halted` are the
 * two states a gateway-managed plan can be in that the customer has to ACT on:
 *
 *   pending_mandate — she started a plan and never finished authorising it, so
 *                     nothing recurs and nothing is charged. The account page
 *                     must offer to finish it, or the plan is invisible dead
 *                     weight she believes is live.
 *   halted          — Razorpay gave up after a run of failed debits. The mandate
 *                     exists; her payment instrument does not work.
 */
export type SubStatus = 'pending_mandate' | 'active' | 'paused' | 'halted' | 'cancelled'

export interface AccountSubscription {
  id: string // subscription id — the account page's Pause/Skip/Cancel controls PATCH by it
  product: string
  qty: number
  frequency: string
  nextDelivery: string
  saved: number
  status: SubStatus
  /** Rupees the mandate debits each cycle; null on a legacy pay-later plan. */
  chargeAmount: number | null
  /** True once her bank approved the mandate. */
  mandateActive: boolean
  /**
   * She has a gateway mandate that was never authorised, so the account page can
   * re-open it. NOT `!mandateActive`: a LEGACY pay-later plan also has no
   * mandate but has nothing to authorise, and a CTA rendered from the negation
   * would 404 on every plan that predates this.
   */
  needsMandate: boolean
}

/** A reward code the customer owns. Redeeming used to flash the code once in
 *  component state; a phone-only account then had no way to ever see it again. */
export interface AccountCoupon {
  id: string
  code: string // "BLOOM-XXXXXXXXXX"
  label: string // "Rs.200 off your next order"
  expires: string | null // "12 Sep 2026"
  used: boolean
}

/** Live earn rates, so "Ways to earn" stops advertising rules no code implements. */
export interface EarnRates {
  pointsPerRupee: number
  firstOrderBonusPoints: number
  reviewPoints: number
  firstOrderBonusEarned: boolean
}

export interface SpendTrend {
  labels: string[]
  values: number[]
  /** False when every bucket is 0 — the view renders an empty state, not a flat line. */
  hasData: boolean
}

export interface ActivityItem {
  label: string
  date: string
  pts: string
}

export interface AccountData {
  user: AccountUser
  pointsBalance: number
  addresses: AccountAddress[]
  orders: AccountOrder[]
  /** ALL of them, newest first, every status. Filtering to 'active' made a paused
   *  plan vanish behind the "no subscription" empty state on the next refresh. */
  subscriptions: AccountSubscription[]
  coupons: AccountCoupon[]
  earnRates: EarnRates
  spendTrend: SpendTrend
  activity: ActivityItem[]
}

// ── Formatting helpers ───────────────────────────────────────────────────────

// Built from parts (not a single format() call) so the output is a guaranteed
// "18 Jun 2026" regardless of the locale's default separators/ordering.
const DMY = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
function fmtDate(d: Date): string {
  const parts = DMY.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}`
}

const MY = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' })
function fmtMonthYear(d: Date): string {
  return MY.format(d)
}

/** Two-letter avatar initials from the name, falling back to the email, then F9. */
function initialsOf(name: string | null, email: string | null): string {
  const src = (name ?? '').trim()
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] ?? ''
    const second = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? ''
    return (first + second).toUpperCase() || 'F9'
  }
  if (email) return email[0].toUpperCase()
  return 'F9'
}

/** National number → "+91 98842 30571". Null in, null out — the caller renders
 *  an "Add your mobile" action for the null case rather than a lone em-dash. */
function fmtPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const n = digits.length > 10 ? digits.slice(-10) : digits
  return n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : `+91 ${n}`
}

/** enum 'delivered' → 'Delivered'. The pill colour comes from statusKey, not
 *  from lowercasing this — every status now has a defined appearance. */
function statusLabel(s: OrderStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Address → the single "City, State pincode" line rendered under `line`. */
function composeCity(a: { city: string; state: string | null; pincode: string | null }): string {
  const cityState = [a.city, a.state].filter(Boolean).join(', ')
  return a.pincode ? `${cityState} ${a.pincode}` : cityState
}

/** "Rs.200 off your next order" / "15% off your next order". */
function couponLabel(type: 'flat' | 'pct', value: number): string {
  return type === 'pct' ? `${value}% off your next order` : `Rs.${value} off your next order`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Bucket order totals into the trailing 6 calendar months for the spend chart.
 *  Computed server-side (fixed month labels, no locale/timezone drift) so the
 *  client component never re-derives dates and can't hydrate-mismatch. */
function buildSpendTrend(rows: { placedAt: Date; total: number }[]): SpendTrend {
  const now = new Date()
  const buckets = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()], total: 0 }
  })
  const byKey = new Map(buckets.map((b) => [b.key, b]))
  for (const r of rows) {
    const b = byKey.get(`${r.placedAt.getFullYear()}-${r.placedAt.getMonth()}`)
    if (b) b.total += r.total
  }
  const values = buckets.map((b) => b.total)
  return { labels: buckets.map((b) => b.label), values, hasData: values.some((v) => v > 0) }
}

/** Shared projection so /account, /welcome and /api/auth/me can never disagree
 *  about a customer's name, initials or completeness. */
export function toAccountUser(user: {
  id: string
  name: string | null
  email: string | null
  emailVerified: Date | null
  phone: string | null
  phoneVerified: Date | null
  image: string | null
  createdAt: Date
}): AccountUser {
  const name = user.name?.trim() || null
  const missing = missingProfileFields({ name, email: user.email, phone: user.phone })
  const firstName = name ? name.split(/\s+/)[0] : null
  return {
    id: user.id,
    name,
    displayName: name ?? 'Your account',
    greeting: firstName ? `Welcome back, ${firstName}` : 'Welcome back',
    initials: initialsOf(name, user.email),
    image: user.image,
    email: user.email,
    emailVerified: user.emailVerified !== null,
    phone: user.phone,
    phoneDisplay: fmtPhone(user.phone),
    phoneVerified: user.phoneVerified !== null,
    // `tier` is never written by any code path, so reading the column would only
    // ever yield null. Hard-coded here until a loyalty-threshold job exists.
    tier: 'Bloom member',
    since: fmtMonthYear(user.createdAt),
    profileComplete: missing.length === 0,
    missing,
  }
}

// ── The read ─────────────────────────────────────────────────────────────────

/**
 * Load the account dashboard for `userId`. Returns null when the id doesn't
 * resolve to a user — the token can be valid yet the record gone — so the caller
 * can bounce to /login rather than render a half-empty page.
 */
export async function getAccountData(brand: Brand, userId: string): Promise<AccountData | null> {
  const prisma = dbFor(brand)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null

  // One round-trip's worth of independent reads, run together.
  const [ordersRaw, addressesRaw, pointsAgg, recentPoints, subsRaw, couponsRaw, welcomeBonusRow, settings] =
    await Promise.all([
      prisma.order.findMany({
        where: { userId },
        orderBy: { placedAt: 'desc' },
        include: { items: { orderBy: { id: 'asc' } } },
      }),
      prisma.address.findMany({
        // Archived rows are soft-deleted: still referenced by their orders, but
        // gone from the address book the customer manages.
        where: { userId, archivedAt: null },
        // Primary first, then stable by id, matching the "Home"/"Work" ordering.
        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      }),
      // Running balance == sum of every ledger delta (same source of truth the
      // checkout award path and the redeem path use).
      prisma.pointsLedger.aggregate({ where: { userId }, _sum: { delta: true } }),
      prisma.pointsLedger.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 4 }),
      prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { variant: { include: { product: { select: { name: true } } } }, cadence: true },
      }),
      prisma.coupon.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      // The welcome bonus is credited by markOrderPaid with this exact reason
      // suffix. Reading the ledger (rather than counting paid orders) is what
      // makes "Earned" true only when points genuinely landed.
      prisma.pointsLedger.findFirst({
        where: { userId, reason: { contains: 'welcome bonus' } },
        select: { id: true },
      }),
      getSettings(brand),
    ])

  const orders: AccountOrder[] = ordersRaw.map((o) => ({
    id: o.orderNo,
    href: `/order/${o.orderNo}`,
    date: fmtDate(o.placedAt),
    items: o.items.map((it) => ({ name: it.productName, qty: it.qty, variantId: it.variantId })),
    total: o.total,
    status: statusLabel(o.status),
    statusKey: o.status,
  }))

  const addresses: AccountAddress[] = addressesRaw.map((a) => ({
    id: a.id,
    label: a.label,
    name: a.name,
    line: a.line,
    city: composeCity(a),
    cityRaw: a.city,
    state: a.state ?? '',
    pincode: a.pincode ?? '',
    phone: a.phone ?? '',
    primary: a.isPrimary,
  }))

  const activity: ActivityItem[] = recentPoints.map((p) => ({
    label: p.reason,
    date: fmtDate(p.createdAt),
    pts: `${p.delta >= 0 ? '+' : '-'}${Math.abs(p.delta).toLocaleString('en-IN')}`,
  }))

  const subscriptions: AccountSubscription[] = subsRaw.map((s) => ({
    id: s.id,
    product: s.variant.product.name,
    qty: s.qty,
    frequency: s.cadence.label,
    nextDelivery: fmtDate(s.nextDeliveryAt),
    saved: s.savedTotal,
    status: s.status as SubStatus,
    chargeAmount: s.chargeAmount,
    mandateActive: s.mandateAuthedAt != null,
    needsMandate: s.razorpaySubscriptionId != null && s.mandateAuthedAt == null,
  }))

  const now = Date.now()
  const coupons: AccountCoupon[] = couponsRaw.map((c) => ({
    id: c.id,
    code: c.code,
    label: couponLabel(c.type, c.value),
    expires: c.expiresAt ? fmtDate(c.expiresAt) : null,
    // Spent, revoked or lapsed — all three mean "you cannot use this at checkout",
    // which is the only distinction the card needs to draw.
    used:
      !c.active ||
      (c.maxUses !== null && c.usedCount >= c.maxUses) ||
      (c.expiresAt !== null && c.expiresAt.getTime() < now),
  }))

  return {
    user: toAccountUser(user),
    pointsBalance: pointsAgg._sum.delta ?? 0,
    addresses,
    orders,
    subscriptions,
    coupons,
    earnRates: {
      pointsPerRupee: settings.pointsPerRupee,
      firstOrderBonusPoints: settings.firstOrderBonusPoints,
      // The flat +50 that reviews-public.ts credits for an approved review on a
      // purchased product. Kept in sync by hand — it is not a Setting row yet.
      reviewPoints: 50,
      firstOrderBonusEarned: welcomeBonusRow !== null,
    },
    spendTrend: buildSpendTrend(ordersRaw.map((o) => ({ placedAt: o.placedAt, total: o.total }))),
    activity,
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface AddressInput {
  label: string
  name: string
  line: string
  city: string
  state?: string
  pincode?: string
  phone?: string
  isPrimary?: boolean
}

export interface ProfileInput {
  name?: string
  email?: string
  phone?: string
}

/**
 * Result of a profile PATCH. A discriminated union rather than a throw for the
 * two *expected* refusals, matching deleteAddress's convention below; a genuine
 * identity collision still throws IdentityConflictError so every caller of
 * attachIdentity handles it the same way.
 */
export type UpdateProfileResult =
  | { status: 'ok'; user: AccountUser }
  | { status: 'not-found' }
  | { status: 'phone-requires-verification' }

/**
 * Write name / email / phone for `userId`.
 *
 * `phone` is accepted by the schema but NEVER written here: a channel that
 * reaches a customer's orders must not be settable by an unverified PATCH, so a
 * changed number is refused and routed to the OTP challenge instead. `email` IS
 * written unverified (with emailVerified cleared and a confirmation link
 * dispatched) — once checkout adopts the session user, email is no longer an
 * identity key for order attachment, and the 409 closes the collision hazard.
 */
export async function updateProfile(brand: Brand, 
  userId: string,
  input: ProfileInput,
): Promise<UpdateProfileResult> {
  const prisma = dbFor(brand)
  const current = await prisma.user.findUnique({ where: { id: userId } })
  if (!current) return { status: 'not-found' }

  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone)
    if (phone !== (current.phone ?? '')) return { status: 'phone-requires-verification' }
  }

  const name = input.name?.trim()
  if (name && name !== current.name) {
    await prisma.user.update({ where: { id: userId }, data: { name } })
  }

  const email = input.email === undefined ? undefined : normalizeEmail(input.email)
  if (email && email !== (current.email ?? '')) {
    // Throws IdentityConflictError when the address belongs to another account;
    // the route maps that to the pinned 409 rather than letting P2002 become a 500.
    await attachIdentity(prisma, userId, { email, emailVerified: null })
    // Fire-and-forget: a Resend outage must not fail a profile save, and the
    // customer can re-request the link from /account.
    dispatchEmailVerification(brand, userId, email)
  }

  const fresh = await prisma.user.findUnique({ where: { id: userId } })
  if (!fresh) return { status: 'not-found' }
  return { status: 'ok', user: toAccountUser(fresh) }
}

/**
 * The shopper's saved address book alone — the same rows and the same shape
 * `getAccountData` returns, without its other six queries. `getAccountData` is
 * the whole dashboard; a caller that only needs to know "does she have a
 * delivery address" (the subscription box builder, before it lets her pay)
 * has no business paying for the orders, points and subscriptions reads too.
 */
export async function listAddresses(brand: Brand, userId: string): Promise<AccountAddress[]> {
  const prisma = dbFor(brand)
  const addressesRaw = await prisma.address.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
  })
  return addressesRaw.map((a) => ({
    id: a.id,
    label: a.label,
    name: a.name,
    line: a.line,
    city: composeCity(a),
    cityRaw: a.city,
    state: a.state ?? '',
    pincode: a.pincode ?? '',
    phone: a.phone ?? '',
    primary: a.isPrimary,
  }))
}

export async function createAddress(brand: Brand, userId: string, input: AddressInput) {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { userId, archivedAt: null } })
    const makePrimary = input.isPrimary === true || count === 0
    if (makePrimary) {
      await tx.address.updateMany({ where: { userId }, data: { isPrimary: false } })
    }
    return tx.address.create({
      data: {
        userId,
        label: input.label.trim(),
        name: input.name.trim(),
        line: input.line.trim(),
        city: input.city.trim(),
        state: input.state?.trim() || null,
        pincode: input.pincode?.trim() || null,
        phone: input.phone?.trim() || null,
        isPrimary: makePrimary,
      },
    })
  })
}

export async function updateAddress(brand: Brand, userId: string, id: string, input: Partial<AddressInput>) {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    // Archived rows are not editable — they only survive to keep an order's FK.
    const exists = await tx.address.findFirst({
      where: { id, userId, archivedAt: null },
      select: { id: true },
    })
    if (!exists) return null
    if (input.isPrimary) await tx.address.updateMany({ where: { userId }, data: { isPrimary: false } })
    return tx.address.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.line !== undefined ? { line: input.line.trim() } : {}),
        ...(input.city !== undefined ? { city: input.city.trim() } : {}),
        ...(input.state !== undefined ? { state: input.state.trim() || null } : {}),
        ...(input.pincode !== undefined ? { pincode: input.pincode.trim() || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      },
    })
  })
}

/**
 * Remove an address from the customer's address book. Order-linked rows are
 * ARCHIVED rather than deleted — Order.addressId still points at them, and the
 * old behaviour (refuse with 'in-use') meant every address a shopper had ever
 * ordered to was permanently undeletable. Rows with no orders are hard-deleted
 * so the table doesn't accumulate tombstones for typos.
 */
export async function deleteAddress(brand: Brand, userId: string, id: string): Promise<'deleted' | 'archived' | 'missing'> {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    const address = await tx.address.findFirst({
      where: { id, userId, archivedAt: null },
      select: { id: true, isPrimary: true, _count: { select: { orders: true } } },
    })
    if (!address) return 'missing'

    const hadOrders = address._count.orders > 0
    if (hadOrders) {
      await tx.address.update({
        where: { id },
        data: { archivedAt: new Date(), isPrimary: false },
      })
    } else {
      await tx.address.delete({ where: { id } })
    }

    // Promote the next surviving address so the book always has a primary.
    if (address.isPrimary) {
      const next = await tx.address.findFirst({
        where: { userId, archivedAt: null },
        orderBy: { id: 'asc' },
        select: { id: true },
      })
      if (next) await tx.address.update({ where: { id: next.id }, data: { isPrimary: true } })
    }
    return hadOrders ? 'archived' : 'deleted'
  })
}

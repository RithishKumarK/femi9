import 'server-only'
import type { Brand } from '@femi9/db'
import {
  keyIdFor,
  keySecretFor,
  paymentsConfigured,
  publicKeyIdFor,
  webhookConfiguredFor,
  webhookSecretFor,
} from './payment-identity'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  configuredEnv,
  mockProvidersAllowed,
  ProviderConfigurationError,
} from './runtime-mode'

/**
 * Razorpay gateway seam.
 *
 * This module is the ONLY place that knows how to talk to Razorpay, so the rest
 * of the app can create gateway orders and verify signatures without caring
 * whether we're live or mocked. We deliberately avoid the `razorpay` npm SDK and
 * hand-roll the two HTTP calls (create order, refund) with `fetch` + node:crypto
 * HMAC — the surface we need is tiny and this keeps the dependency footprint and
 * the runtime (must stay Node, for createHmac) under our control.
 *
 * MOCK MODE is explicit (`ALLOW_MOCK_PROVIDERS=true`) and is additionally
 * disabled whenever NODE_ENV=production. Missing live credentials therefore
 * fail closed instead of silently turning checkout into a free mock-payment
 * path.
 */

const ORDERS_URL = 'https://api.razorpay.com/v1/orders'
const PAYMENTS_URL = 'https://api.razorpay.com/v1/payments'

/**
 * Ceiling on any single gateway HTTP call.
 *
 * `fetch` has no default timeout: a gateway that accepts a connection and then
 * stops talking hangs the caller until the platform gives up, which for a
 * refund means an admin request pinned open with money already moved. Bounding
 * it turns that into a definite, reportable failure.
 */
const GATEWAY_TIMEOUT_MS = Number(process.env.RAZORPAY_TIMEOUT_MS) || 15_000

/**
 * Raised only when the gateway is KNOWN not to have acted — it answered, and
 * the answer was a refusal (4xx that is not a rate limit). Callers may safely
 * undo whatever they staged in anticipation.
 *
 * Everything else — a timeout, a dropped socket, a 5xx, a 429 — is deliberately
 * NOT this error, because none of them distinguish "never reached Razorpay"
 * from "Razorpay did it and the reply was lost". That ambiguity is the whole
 * reason a refund claim must survive a failure rather than be rolled back.
 */
export class GatewayNotExecutedError extends Error {
  readonly status: number
  constructor(operation: string, status: number, detail: string) {
    super(`Razorpay ${operation} refused (${status}): ${detail}`)
    this.name = 'GatewayNotExecutedError'
    this.status = status
  }
}

/** A 4xx that is not a 429 means the request was understood and declined. */
function classifyFailure(operation: string, status: number, detail: string): Error {
  if (status >= 400 && status < 500 && status !== 429) {
    return new GatewayNotExecutedError(operation, status, detail)
  }
  return new Error(`Razorpay ${operation} failed (${status}): ${detail}`)
}

/** Live only when BOTH halves of the API credential are present. A half-set
 *  config (one env var) would fail every real call, so we treat it as unset. */
export function isConfigured(brand: Brand): boolean {
  return paymentsConfigured(brand)
}

export function webhookConfigured(brand: Brand): boolean {
  return webhookConfiguredFor(brand)
}

/** The publishable key the browser Checkout widget needs. Public by design
 *  (NEXT_PUBLIC_*); empty string in mock mode so the client can branch on it. */
export function publicKeyId(brand: Brand): string {
  return publicKeyIdFor(brand)
}

/** HTTP Basic header for the private API (key_id:key_secret, base64). Only ever
 *  called on the configured path, so the env vars are guaranteed present. */
function basicAuthHeader(brand: Brand): string {
  const keyId = keyIdFor(brand) ?? ''
  const keySecret = keySecretFor(brand) ?? ''
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
}

/** Constant-time string compare over equal-length hex digests. A plain `===`
 *  leaks timing; length is checked first because timingSafeEqual throws on a
 *  size mismatch (and a different length already means "not equal"). */
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export interface GatewayOrder {
  id: string
  amount: number // paise
  mock: boolean
}

/**
 * Open a payment order on the gateway for `amountRupees`.
 *
 * Razorpay works in PAISE, so we convert here (rupees are integers in our data,
 * Math.round guards any float drift). Configured → real Orders API. Not
 * configured → an explicit local/test mock id keyed on the receipt (our orderNo)
 * so a retry maps to the same mock order, with NO network call. Production fails
 * closed when credentials are absent.
 */
export async function createOrder(brand: Brand, {
  amountRupees,
  receipt,
}: {
  amountRupees: number
  receipt: string
}): Promise<GatewayOrder> {
  const amountPaise = Math.round(amountRupees * 100)

  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return { id: `mock_${receipt}`, amount: amountPaise, mock: true }
  }

  const res = await fetch(ORDERS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basicAuthHeader(brand) },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyFailure('createOrder', res.status, detail)
  }
  const data = (await res.json()) as { id: string; amount: number }
  return { id: data.id, amount: data.amount, mock: false }
}

/**
 * Verify the signature Razorpay Checkout hands back on a successful payment:
 * HMAC_SHA256(order_id|payment_id, key_secret), hex, compared constant-time to
 * `razorpay_signature`. Returns false when unconfigured — there is no secret to
 * sign with, so a "valid" result would be meaningless (the mock flow does not
 * route through here).
 */
export function verifyPaymentSignature(
  brand: Brand,
  {
    orderId,
    paymentId,
    signature,
  }: {
    orderId: string
    paymentId: string
    signature: string
  },
): boolean {
  const secret = keySecretFor(brand)
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
  return safeEqual(expected, signature)
}

/**
 * Verify a webhook call: HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) hex,
 * compared to the `x-razorpay-signature` header. MUST run against the exact raw
 * request bytes (not a re-serialized JSON), so callers pass the untouched body
 * text. Returns false if the webhook secret is unset or the header is missing.
 */
export function verifyWebhookSignature(
  brand: Brand,
  rawBody: string,
  signature: string | null,
): boolean {
  // The secret of the account that RAISED the charge. Once the brands have
  // separate accounts, verifying a Lumi9 webhook against Femi9's secret fails
  // here and the order is silently never marked paid — which is why each brand
  // gets its own webhook endpoint.
  const secret = webhookSecretFor(brand)
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqual(expected, signature)
}

export interface GatewayRefund {
  id: string
  mock: boolean
  /** True when this refund already existed at the gateway and was adopted
   *  rather than created — i.e. a retry converged instead of paying twice. */
  adopted: boolean
}

export interface GatewayPayment {
  id: string
  orderId: string
  amount: number
  status: string
  method?: string
}

/** Read gateway payments for reconciliation. Amount is returned in paise. */
export async function listOrderPayments(brand: Brand, orderId: string): Promise<GatewayPayment[]> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return []
  }
  const res = await fetch(`${ORDERS_URL}/${encodeURIComponent(orderId)}/payments`, {
    headers: { authorization: basicAuthHeader(brand) },
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyFailure('listOrderPayments', res.status, detail)
  }
  const data = await res.json() as {
    items?: Array<{ id: string; order_id: string; amount: number; status: string; method?: string }>
  }
  return (data.items ?? []).map((p) => ({
    id: p.id,
    orderId: p.order_id,
    amount: p.amount,
    status: p.status,
    method: p.method,
  }))
}

/** Refunds already recorded against a payment, newest first. Amounts in paise. */
async function listRefunds(brand: Brand, paymentId: string): Promise<Array<{ id: string; amount: number }>> {
  const res = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(paymentId)}/refunds`, {
    headers: { authorization: basicAuthHeader(brand) },
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyFailure('listRefunds', res.status, detail)
  }
  const data = (await res.json()) as { items?: Array<{ id: string; amount: number }> }
  return data.items ?? []
}

/**
 * Refund a captured payment (full, or partial when `amountRupees` is given).
 * Configured → real Refunds API; mock → a synthetic refund id, no network call.
 *
 * IDEMPOTENT BY READ-BEFORE-WRITE. Razorpay's Refunds API has no idempotency
 * key, so a retry after an ambiguous failure (timeout, dropped socket, 5xx)
 * would otherwise return the customer's money a second time — real money, with
 * nothing in our data to say it happened. Every call therefore asks what has
 * already been refunded against this payment and ADOPTS a matching refund
 * instead of creating one, which makes the whole operation safe to retry until
 * it converges.
 *
 * Existing refunds that do NOT cover the requested amount are refused rather
 * than topped up: that is a partial-refund history this console never creates,
 * so it means something else has touched the payment and a human should look
 * before any more money moves.
 */
export async function refundPayment(brand: Brand, paymentId: string, amountRupees?: number): Promise<GatewayRefund> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return { id: `mock_refund_${paymentId}`, mock: true, adopted: false }
  }

  const wantPaise = amountRupees != null ? Math.round(amountRupees * 100) : null

  const existing = await listRefunds(brand, paymentId)
  if (existing.length > 0) {
    const refunded = existing.reduce((sum, r) => sum + r.amount, 0)
    // `null` means "full refund" and cannot be compared against a total, so any
    // existing refund counts as this operation already having happened.
    if (wantPaise == null || refunded >= wantPaise) {
      return { id: existing[0].id, mock: false, adopted: true }
    }
    throw new Error(
      `Razorpay refund refused: payment ${paymentId} already has ${existing.length} refund(s) ` +
      `totalling ${refunded} paise, short of the ${wantPaise} paise requested. ` +
      `Reconcile by hand — refunding again would return more than was charged.`,
    )
  }

  const res = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basicAuthHeader(brand) },
    // Omit the body for a full refund; Razorpay refunds the full amount when no
    // amount is supplied. Partial refunds pass the amount in paise.
    body: wantPaise != null ? JSON.stringify({ amount: wantPaise }) : undefined,
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyFailure('refund', res.status, detail)
  }
  const data = (await res.json()) as { id: string }
  return { id: data.id, mock: false, adopted: false }
}

// ─────────────────────────── Subscriptions (mandates) ────────────────────────
//
// The Subscriptions API is a DIFFERENT money object from the Orders API above.
// An Order is one charge we initiate; a Subscription is a MANDATE the customer's
// bank or UPI app authorises once, after which RAZORPAY decides when to debit,
// retries a failure on its own schedule, and reports each success to us as a
// `subscription.charged` webhook. Nothing here charges anybody — creating a plan
// and a subscription only sets up the rails; money moves when the gateway says.
//
// The shape is always: Plan (amount + rhythm) → Subscription (a customer's
// mandate against that plan) → Checkout authorises it → webhooks thereafter.

const PLANS_URL = 'https://api.razorpay.com/v1/plans'
const SUBSCRIPTIONS_URL = 'https://api.razorpay.com/v1/subscriptions'

/** Razorpay's billing rhythms. `interval` multiplies whichever is chosen. */
export type PlanPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Shared POST helper for the subscription endpoints — same auth, same error
 *  shape, so each call below is just its URL and body. */
async function postJson<T>(brand: Brand, url: string, body: unknown, label: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basicAuthHeader(brand) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyFailure(label, res.status, detail)
  }
  return (await res.json()) as T
}

export interface GatewayPlan {
  id: string
  mock: boolean
}

/**
 * Create a Plan: an amount charged on a rhythm, with no customer attached.
 *
 * Plans are immutable on Razorpay and cheap to create but impossible to delete,
 * so callers MUST go through services/subscription-plans.ts, which caches one
 * per (amount, period, interval) rather than minting a fresh plan per subscribe
 * click.
 */
export async function createPlan(
  brand: Brand,
  {
    period,
    interval,
    name,
    amountRupees,
    notes,
  }: {
    period: PlanPeriod
    interval: number
    name: string
    amountRupees: number
    notes?: Record<string, string>
  },
): Promise<GatewayPlan> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return { id: `mock_plan_${period}_${interval}_${Math.round(amountRupees * 100)}`, mock: true }
  }
  const data = await postJson<{ id: string }>(
    brand,
    PLANS_URL,
    {
      period,
      interval,
      item: { name, amount: Math.round(amountRupees * 100), currency: 'INR' },
      notes,
    },
    'createPlan',
  )
  return { id: data.id, mock: false }
}

export interface GatewaySubscription {
  id: string
  status: string
  shortUrl: string | null
  currentEnd: Date | null
  mock: boolean
}

/** Razorpay returns epoch SECONDS (or null) for every timestamp on these
 *  entities. Anything else — including 0 — is treated as absent rather than
 *  becoming 1 Jan 1970 on a customer's "next delivery" line. */
function epochToDate(v: unknown): Date | null {
  return typeof v === 'number' && v > 0 ? new Date(v * 1000) : null
}

type SubscriptionEntity = {
  id: string
  status: string
  short_url?: string | null
  current_end?: number | null
  customer_id?: string | null
  plan_id?: string | null
}

function toGatewaySubscription(data: SubscriptionEntity): GatewaySubscription {
  return {
    id: data.id,
    status: data.status,
    shortUrl: data.short_url ?? null,
    currentEnd: epochToDate(data.current_end),
    mock: false,
  }
}

/**
 * Open a subscription against a plan. The returned id is what the browser hands
 * to Checkout as `subscription_id`; until the customer authorises there, the
 * subscription sits at status `created` and NOTHING is ever debited.
 *
 * `totalCount` is how many cycles the mandate covers — Razorpay requires a
 * finite number, so an open-ended refill plan asks for a long horizon (see
 * MANDATE_TOTAL_COUNT in services/subscriptions.ts) rather than pretending to be
 * infinite.
 *
 * `customerNotify: 0` keeps Razorpay's own emails off: the customer already gets
 * our order confirmation from `markOrderPaid`, and two unrelated receipts for one
 * debit is worse than one.
 */
export async function createSubscription(
  brand: Brand,
  {
    planId,
    totalCount,
    quantity = 1,
    notes,
    startAt,
  }: {
    planId: string
    totalCount: number
    quantity?: number
    notes?: Record<string, string>
    startAt?: Date
  },
): Promise<GatewaySubscription> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return {
      id: `mock_sub_${planId}_${Math.random().toString(36).slice(2, 10)}`,
      status: 'created',
      shortUrl: null,
      currentEnd: null,
      mock: true,
    }
  }
  const data = await postJson<SubscriptionEntity>(
    brand,
    SUBSCRIPTIONS_URL,
    {
      plan_id: planId,
      total_count: totalCount,
      quantity,
      customer_notify: 0,
      notes,
      ...(startAt ? { start_at: Math.floor(startAt.getTime() / 1000) } : {}),
    },
    'createSubscription',
  )
  return toGatewaySubscription(data)
}

/** Read a subscription back from the gateway — the source of truth whenever a
 *  webhook was missed or a local row looks stale. */
export async function fetchSubscription(
  brand: Brand,
  id: string,
): Promise<GatewaySubscription | null> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return null
  }
  const res = await fetch(`${SUBSCRIPTIONS_URL}/${encodeURIComponent(id)}`, {
    headers: { authorization: basicAuthHeader(brand) },
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyFailure('fetchSubscription', res.status, detail)
  }
  return toGatewaySubscription((await res.json()) as SubscriptionEntity)
}

/**
 * Pause billing. `pause_at: 'now'` stops the next debit immediately rather than
 * at the cycle boundary — which is what a customer pressing "Pause" means, and
 * the only variant that also serves `skipNext`.
 */
export async function pauseSubscription(
  brand: Brand,
  id: string,
): Promise<GatewaySubscription | null> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return null
  }
  return toGatewaySubscription(
    await postJson<SubscriptionEntity>(
      brand,
      `${SUBSCRIPTIONS_URL}/${encodeURIComponent(id)}/pause`,
      { pause_at: 'now' },
      'pauseSubscription',
    ),
  )
}

export async function resumeSubscription(
  brand: Brand,
  id: string,
): Promise<GatewaySubscription | null> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return null
  }
  return toGatewaySubscription(
    await postJson<SubscriptionEntity>(
      brand,
      `${SUBSCRIPTIONS_URL}/${encodeURIComponent(id)}/resume`,
      { resume_at: 'now' },
      'resumeSubscription',
    ),
  )
}

/**
 * Cancel the mandate. `atCycleEnd` defaults to FALSE — a customer who presses
 * "Cancel" expects the debits to stop, not one more to land. Pass true only
 * where the cycle has already been paid for and is still to be delivered.
 */
export async function cancelSubscription(
  brand: Brand,
  id: string,
  atCycleEnd = false,
): Promise<GatewaySubscription | null> {
  if (!isConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('Razorpay')
    return null
  }
  return toGatewaySubscription(
    await postJson<SubscriptionEntity>(
      brand,
      `${SUBSCRIPTIONS_URL}/${encodeURIComponent(id)}/cancel`,
      { cancel_at_cycle_end: atCycleEnd ? 1 : 0 },
      'cancelSubscription',
    ),
  )
}

/**
 * Verify the signature Checkout returns after a MANDATE is authorised.
 *
 * The signed payload is `payment_id|subscription_id` — note the order, which is
 * the REVERSE of the `order_id|payment_id` used for a one-off payment above.
 * Getting it backwards produces a valid-looking HMAC that never matches, and the
 * failure reads as "the customer's bank declined" rather than "we signed the
 * wrong string", so the two verifiers are kept apart deliberately rather than
 * sharing a parameterised helper.
 */
export function verifySubscriptionSignature(
  brand: Brand,
  {
    subscriptionId,
    paymentId,
    signature,
  }: {
    subscriptionId: string
    paymentId: string
    signature: string
  },
): boolean {
  const secret = keySecretFor(brand)
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(`${paymentId}|${subscriptionId}`).digest('hex')
  return safeEqual(expected, signature)
}

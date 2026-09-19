import 'server-only'
import type { Brand } from '@femi9/db'
import { perBrandEnv } from './env-identity'
import { mockProvidersAllowed, ProviderConfigurationError } from './runtime-mode'

/**
 * WhatsApp Cloud API transport.
 *
 * The ONLY place that knows how to talk to Meta's Graph endpoint. Everything
 * above it names a template and hands over parameters; nothing above it builds
 * a URL, a token header or a `components` array.
 *
 * ── One WABA, two brands ───────────────────────────────────────────────────
 * Femi9 and Lumi9 share the business account, the phone number and the five
 * approved templates — the copy says "Femi9" in both today, which is a known
 * and accepted state until Lumi9's own templates are approved. Credentials
 * still resolve per brand (`WHATSAPP_TOKEN_LUMI9`, else `WHATSAPP_TOKEN`), so
 * splitting them later is one variable and no code change. See env-identity.ts.
 *
 * ── Templates are the only thing we may send ───────────────────────────────
 * Outside a 24-hour customer-service window Meta accepts nothing but a
 * PRE-APPROVED template, referenced BY NAME. The names below are approved and
 * are not ours to invent: a name that does not exist on the WABA fails with a
 * 132001 at send time, which looks exactly like an outage and is not one. A new
 * message means getting a new template approved first — do not repurpose one of
 * these, because the body copy is fixed and only the variables change.
 *
 * The IDs are recorded next to each name for the ops trail — the send API keys
 * off the name, never the ID.
 */

export const WHATSAPP_TEMPLATES = {
  /** 778500351016365 — body: {customername}, {OTP} */
  signupOtp: 'signup_otp',
  /** 2031434690638770 — body: {customername}, {OTP} */
  loginOtp: 'login_otp',
  /** 1684656215504488 — body: {customername}, {ordernumber}, {orderproductlist}, {ordertotalprice} */
  orderConfirmation: 'order_status_confirmation',
  /** 1539875743298070 — body: {customername}, {ordernumber}, {status} */
  orderDelivered: 'order_status_delivered',
  /** 537281502283564 — body: {customername}, {ordernumber} */
  orderCancelled: 'order_status_cancell',
} as const

declare const configuredBrand: unique symbol

/**
 * A template name that comes from the environment rather than from the list
 * above, because it is not approved yet.
 *
 * Branded so it cannot be conjured from an arbitrary string: the ONLY way to
 * obtain one is `invoiceTemplateName()`, which reads the env var. That keeps
 * the doctrine at the top of this file intact — nobody can invent a template
 * name at a call site — while still allowing a name that Meta has approved
 * after this code shipped.
 */
export type ConfiguredWhatsappTemplate = string & { readonly [configuredBrand]: true }

export type WhatsappTemplate =
  | (typeof WHATSAPP_TEMPLATES)[keyof typeof WHATSAPP_TEMPLATES]
  | ConfiguredWhatsappTemplate

/**
 * The approved template that carries the receipt PDF, if there is one yet.
 *
 * ── Why this is env-configured and not a constant ──────────────────────────
 * A PDF can only ride along on a template whose APPROVED definition declares a
 * DOCUMENT header. `order_status_confirmation` does not — it is body-only, so
 * adding a header component to it fails at send time with a 132000 (parameter
 * count mismatch), which reads like an outage and is not one. The attachment
 * therefore needs a NEW template, approved on the WABA, and the approval is an
 * ops action with a multi-day turnaround that no deploy can shortcut.
 *
 * So: unset means "not approved yet", and the order path keeps sending today's
 * body-only confirmation. Set it to the approved name and the PDF starts
 * riding along, with no deploy. The variable holds the NAME rather than a
 * boolean precisely because the name is Meta's to grant, not ours to guess.
 *
 * The new template's body must declare the same four variables in the same
 * order as `order_status_confirmation` — {customername}, {ordernumber},
 * {orderproductlist}, {ordertotalprice} — because both paths send the same
 * params array. A template approved with a different body shape will send, and
 * will render the wrong values in the wrong places, which is worse than a
 * failure.
 */
export function invoiceTemplateName(): ConfiguredWhatsappTemplate | null {
  const name = process.env.WHATSAPP_INVOICE_TEMPLATE?.trim()
  return name ? (name as ConfiguredWhatsappTemplate) : null
}

/**
 * The approved template that asks a customer to correct her delivery address,
 * if there is one yet.
 *
 * ── Why this is env-configured and not a constant ──────────────────────────
 * The same reason as `invoiceTemplateName()` above, and worth restating
 * because the temptation here is stronger. None of the five approved templates
 * says anything about an address: `order_status_confirmation` reads as a
 * receipt and `order_status_delivered` says the order "has been" completed.
 * Reaching for one of them to ask her to fix an address would land on her
 * phone, render fluently, and tell her something that is not true — which is
 * worse than sending nothing at all.
 *
 * So: unset means "not approved yet", and the grant path sends the EMAIL and
 * records `template-not-approved` as the reason WhatsApp was skipped. Set it
 * to the approved name and the message starts going out, with no deploy. That
 * matters more here than for the invoice, because the customers this message
 * is FOR are disproportionately the phone-only signups who have no email
 * address at all — for them, no template means no notification.
 *
 * The template must be approved BODY-ONLY, with exactly three variables in
 * this order:
 *
 *   {{1}}  her first name
 *   {{2}}  the order number, e.g. LM-00014
 *   {{3}}  the full https link to her order page
 *
 * A different variable COUNT fails at send time with a 132000 that reads like
 * an outage. The same count in a different ORDER does not fail at all — it
 * sends, and renders the link where the name goes. Neither is visible from
 * here, so the shape above is the contract.
 *
 * And it must be body-only rather than a URL-BUTTON template, however much
 * better a button would read: `sendWhatsappTemplate` builds `header` and
 * `body` components and nothing else, so a button's dynamic suffix would never
 * be sent and Meta would reject the whole message. Approving a button template
 * means teaching the transport about button components first.
 */
export function addressChangeTemplateName(): ConfiguredWhatsappTemplate | null {
  const name = process.env.WHATSAPP_ADDRESS_CHANGE_TEMPLATE?.trim()
  return name ? (name as ConfiguredWhatsappTemplate) : null
}

/** `WHATSAPP_TOKEN_LUMI9`, else the shared `WHATSAPP_TOKEN`. */
export function whatsappTokenFor(brand: Brand): string | undefined {
  return perBrandEnv('WHATSAPP_TOKEN', brand)
}

/** `WHATSAPP_PHONE_NUMBER_ID_LUMI9`, else the shared `WHATSAPP_PHONE_NUMBER_ID`.
 *  This is the Cloud API's numeric sender id, NOT the phone number itself. */
export function whatsappPhoneIdFor(brand: Brand): string | undefined {
  return perBrandEnv('WHATSAPP_PHONE_NUMBER_ID', brand)
}

/** True when this brand can actually send a WhatsApp message. */
export function whatsappConfigured(brand: Brand): boolean {
  return Boolean(whatsappTokenFor(brand) && whatsappPhoneIdFor(brand))
}

/**
 * The Graph version to call. Pinned in env rather than left to a floating
 * default because Meta retires versions on a schedule, and a silently-moved
 * default changes the shape of a live, payment-adjacent notification path.
 */
function apiVersion(): string {
  return process.env.WHATSAPP_API_VERSION?.trim() || 'v22.0'
}

/**
 * The language code the templates were approved under.
 *
 * `en_US`, because that is what all five ARE — verified against the WABA's
 * template list, not assumed. This defaulted to `en` and every send failed with
 * 132001, which reads "template does not exist": Meta matches on the NAME AND
 * LANGUAGE PAIR, so `login_otp`/`en` is a different template from
 * `login_otp`/`en_US`, and the error cannot tell you which half was wrong.
 *
 * That cost a deployment to find, because the shopper saw "WhatsApp sign-in is
 * temporarily unavailable" and nothing was logged. A default that is wrong for
 * the only templates that exist is a trap, so the default is now the truth and
 * WHATSAPP_TEMPLATE_LANGUAGE remains the override for a WABA that differs.
 */
function templateLanguage(): string {
  return process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en_US'
}

/**
 * A bare national 10-digit number to the E.164 digits Meta wants (no `+`).
 *
 * Every customer number in both databases is Indian and stored as 10 digits by
 * `normalizePhone`, but an address row is free text a human typed, so `+91`,
 * a leading `0`, spaces and dashes all turn up. Reduce to digits, keep the last
 * ten, prefix 91.
 */
export function toWhatsappNumber(phone: string): string | null {
  const digits = (phone || '').replace(/\D/g, '')
  const national = digits.length > 10 ? digits.slice(-10) : digits
  if (national.length !== 10) return null
  return `91${national}`
}

/**
 * Make a value safe to put in a template parameter.
 *
 * Meta rejects the whole message (131009) when a body parameter contains a
 * newline, a tab, or four-plus consecutive spaces — which is exactly what a
 * multi-line order line-item list is. Collapsing whitespace here, once, keeps
 * that failure out of every caller. An empty parameter is rejected too, so an
 * absent value becomes a dash rather than a 400.
 */
export function templateParam(value: string | number | null | undefined): string {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > 0 ? flat : '-'
}

/** What happened to a send. `sent:false` with a reason is an honest "we could
 *  not tell her", which callers log rather than swallow. */
export interface WhatsappSendResult {
  sent: boolean
  mock: boolean
  reason?: string
}

/** A PDF to attach, already uploaded to Meta by `uploadWhatsappDocument`. */
export interface WhatsappDocument {
  /** The media id from the upload. NOT a URL - see uploadWhatsappDocument. */
  mediaId: string
  /** What WhatsApp shows under the paperclip, and what saving it writes. */
  filename: string
}

export interface WhatsappTemplateInput {
  /** Any form of the customer's number; normalised here. */
  to: string
  template: WhatsappTemplate
  /** Body variables, IN THE ORDER THEY APPEAR IN THE APPROVED TEMPLATE. */
  params: (string | number | null | undefined)[]
  /**
   * Attach a document to the template's HEADER.
   *
   * Only valid when the approved template declares a document header. Sending
   * one to a body-only template is a 132000, so callers must pair this with a
   * template name that has the header — see `invoiceTemplateName()`.
   */
  document?: WhatsappDocument
}

/**
 * Upload a PDF to Meta and get back a media id.
 *
 * ── Why a media id rather than a link ──────────────────────────────────────
 * The Cloud API accepts either `{ link }` or `{ id }` for a document header.
 * `link` requires the PDF to sit at a publicly fetchable HTTPS URL, which for a
 * receipt means publishing a document containing a customer's name, full postal
 * address and phone number to an unauthenticated endpoint so that Meta's
 * crawler can read it. Every order receipt would be one URL guess from public.
 *
 * Uploading gets an opaque, account-scoped id instead, and nothing about the
 * receipt is ever reachable without a WABA token. The id is good for 30 days,
 * which is far longer than the seconds we need it for.
 *
 * Returns null rather than throwing: a failed upload must degrade to the
 * body-only confirmation, never to no message at all.
 */
export async function uploadWhatsappDocument(
  brand: Brand,
  file: { bytes: Uint8Array; filename: string },
): Promise<string | null> {
  if (!whatsappConfigured(brand)) return null

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', 'application/pdf')
  // Copied into a fresh ArrayBuffer: a Uint8Array from a pooled buffer can be a
  // VIEW onto a larger allocation, and handing that straight to Blob uploads
  // the whole pool - here, whatever else happened to share it.
  const bytes = new Uint8Array(file.bytes.byteLength)
  bytes.set(file.bytes)
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), file.filename)

  try {
    const res = await fetch(
      `https://graph.facebook.com/${apiVersion()}/${whatsappPhoneIdFor(brand)}/media`,
      {
        method: 'POST',
        // No content-type header: fetch must set the multipart boundary itself,
        // and setting it by hand produces a body Meta cannot parse.
        headers: { authorization: `Bearer ${whatsappTokenFor(brand)}` },
        body: form,
      },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { id?: unknown }
    return typeof body.id === 'string' && body.id.length > 0 ? body.id : null
  } catch {
    return null
  }
}

/**
 * Send one approved template message.
 *
 * Never throws — a Meta outage must not roll back a captured payment or block an
 * ops status change. The one caller with nothing to fall back on uses
 * `sendWhatsappTemplateOrThrow` below.
 *
 * MOCK: an explicit local/test mode does nothing and reports mock:true, so the
 * whole flow is exercisable without a live WABA or a per-message bill.
 */
export async function sendWhatsappTemplate(
  brand: Brand,
  input: WhatsappTemplateInput,
): Promise<WhatsappSendResult> {
  if (!whatsappConfigured(brand)) {
    if (mockProvidersAllowed()) return { sent: true, mock: true }
    return { sent: false, mock: false, reason: 'WhatsApp is not configured' }
  }

  const to = toWhatsappNumber(input.to)
  if (!to) return { sent: false, mock: false, reason: 'Not a valid 10-digit mobile number' }

  const url = `https://graph.facebook.com/${apiVersion()}/${whatsappPhoneIdFor(brand)}/messages`

  // The header comes FIRST when there is one. Meta matches components to the
  // approved template by their `type`, not by position, but an out-of-order
  // array is the kind of thing a future reader "fixes" - keeping it in the
  // template's own order removes the question.
  const components: unknown[] = []
  if (input.document) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: { id: input.document.mediaId, filename: input.document.filename },
        },
      ],
    })
  }
  components.push({
    type: 'body',
    parameters: input.params.map((p) => ({ type: 'text', text: templateParam(p) })),
  })

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: input.template,
      language: { code: templateLanguage() },
      components,
    },
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${whatsappTokenFor(brand)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        sent: false,
        mock: false,
        reason: `WhatsApp ${input.template} failed (${res.status}): ${detail.slice(0, 300)}`,
      }
    }
    return { sent: true, mock: false }
  } catch (err) {
    return {
      sent: false,
      mock: false,
      reason: `WhatsApp ${input.template} threw: ${String(err).slice(0, 300)}`,
    }
  }
}

/**
 * As above, but a failure is an exception.
 *
 * For the OTP challenge only. `requestOtp` has already written the code's hash
 * to VerificationToken by the time we get here, so reporting success on a failed
 * send would leave a shopper on a code-entry screen with no code ever arriving
 * and the route answering 200. Throwing lets the route tell her to try again.
 */
export async function sendWhatsappTemplateOrThrow(
  brand: Brand,
  input: WhatsappTemplateInput,
): Promise<{ mock: boolean }> {
  if (!whatsappConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('WhatsApp')
    return { mock: true }
  }
  const result = await sendWhatsappTemplate(brand, input)
  if (!result.sent) throw new Error(result.reason ?? `WhatsApp ${input.template} failed`)
  return { mock: result.mock }
}

import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../brands'
import { storefrontOrigin } from '../env-identity'
import { logger } from '../logger'
import { addressChangeTemplateName } from '../whatsapp'
import { addressEditState } from './order-address'
import { sendEmailNotification, sendWhatsappNotification } from './notifications'

/**
 * Telling the customer that her address correction is open.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `services/order-address.ts` built the whole one-time correction — the grant,
 * the window, the consume — and `setOrderAddressEditGrant` opened it from the
 * console. Nothing told the customer. The control renders on HER order page,
 * behind a sign-in, on a page she has no reason to revisit after paying, so
 * support opening the window was an act with no observable effect: the parcel
 * sat unshippable and the only way she ever found out was if somebody phoned
 * her, which is the call this feature was written to avoid.
 *
 * The case that forced it is the one order-address.ts names. LM-00014 was
 * created, charged and marked paid with `addressId: null` — a subscription
 * renewal against a customer who had never saved an address. Nothing failed
 * and the money arrived. Opening the window fixes it only if she is told.
 *
 * ── Why it is a separate module from order-mail / order-whatsapp ────────────
 * Those two are keyed on order STATUS, and this is not a status: an order is
 * still `paid` before and after support opens a window. Folding it into
 * `OrderMailStatus` would put a value in that union which no order can ever
 * hold. It is also one event that must go out on BOTH channels with the SAME
 * link and the same sentence, and splitting it across the two files would give
 * the link two builders and the copy two homes.
 *
 * ── Both channels, and why neither is sufficient alone ──────────────────────
 * The customer this reaches is usually a phone-only signup — that is the
 * default way into both storefronts, and `order.user.email` is null for every
 * one of them, which is the identity gap `order-mail.ts` documents. So email
 * alone reaches nobody in the common case. But WhatsApp alone is not enough
 * either: the message needs an approved template that does not exist yet (see
 * `addressChangeTemplateName`), and a Google-signup customer may have an email
 * and no phone at all. So both are attempted, each failure is named, and the
 * caller is told what actually went out — because "nobody could be reached"
 * has to become a phone call, and support can only make it if it is told.
 *
 * ── Why nothing here throws ─────────────────────────────────────────────────
 * The grant is already written by the time this runs. A Meta outage or an
 * unverified SES identity must not roll it back, and must not turn an admin's
 * click into a 500 that leaves them re-clicking a button that already worked.
 */

/** Why one channel did not carry the message. `null` when it did. */
export type AddressChangeSkipReason =
  /** No approved WhatsApp template is configured yet — see addressChangeTemplateName. */
  | 'template-not-approved'
  /** A phone-only account: `user.email` is null, as it is for every OTP signup. */
  | 'no-email'
  /** No number on the account and none on the shipping address either. */
  | 'no-phone'
  /** The provider took it and refused it, or is not configured. */
  | 'send-failed'

export interface AddressChangeChannelResult {
  sent: boolean
  reason: AddressChangeSkipReason | null
}

export interface AddressChangeNotifyResult {
  /** The link the customer was given, so the console can read it out on a call. */
  url: string
  email: AddressChangeChannelResult
  whatsapp: AddressChangeChannelResult
  /** True when neither channel carried it. The one field support must act on. */
  unreachable: boolean
  /**
   * Set when the correction cannot work for this order however it is
   * announced, so nothing was sent and nothing is worth retrying.
   *
   * `guest-order` is the only one today and it is the one that catches people
   * out: the edit is scoped by `userId`, a guest checkout has no user row, and
   * there is therefore no session on earth that owns this order. Sending her a
   * link would produce a page with no control on it and a second support call.
   */
  blocked: 'guest-order' | null
}

/**
 * The customer's own order page — where the "Change delivery address" button
 * lives once support has opened the window.
 *
 * The origin comes from the BRAND rather than from the process (see
 * `storefrontOrigin`): this is called from the console, which serves both
 * brands from one container and would otherwise send every Lumi9 customer to
 * Femi9's storefront, or to a bare path.
 *
 * No `?t=` capability token, deliberately. That token authorises READING the
 * page and would happily travel in a forwarded WhatsApp message; the address
 * write behind this link takes the SESSION and nothing else, precisely so a
 * forwarded link cannot redirect somebody's parcel. She signs in, which she
 * has to do anyway for the control to render.
 */
export function orderPageUrl(brand: Brand, orderNo: string): string {
  return `${storefrontOrigin(brand)}/order/${encodeURIComponent(orderNo)}`
}

export interface AddressChangeCopy {
  subject: string
  text: string
  html: string
}

/**
 * The email, as copy.
 *
 * Pure and exported so the wording is testable without a database, a mail
 * provider or a live grant — and so the two channels below cannot drift into
 * saying different things.
 *
 * Three things the copy has to get right, all of them learned from the flow
 * rather than from a style guide:
 *
 *  - It must name the SIGN-IN. The button renders only for a session, so a
 *    customer who follows the link while signed out sees her order and no way
 *    to change anything, concludes the link is broken, and calls.
 *  - It must name the button, in the words the button uses ("Change delivery
 *    address"). She is looking for a control on a page she has never used.
 *  - It must say ONE change, BEFORE dispatch. That is the actual rule, it is
 *    enforced server-side, and a customer who saves a half-finished address
 *    because nobody told her has spent her only correction.
 */
export function renderAddressChangeEmail(input: {
  brand: Brand
  /** Her first name, or a neutral greeting. Never empty. */
  greeting: string
  orderNo: string
  url: string
}): AddressChangeCopy {
  const { brand, greeting, orderNo, url } = input
  const name = brandConfig(brand).name

  const subject = `Your ${name} order ${orderNo} — we need your delivery address`

  const text = [
    `Hi ${greeting},`,
    '',
    `We are getting order ${orderNo} ready to send, but we do not have a delivery`,
    'address we can ship it to. Nothing is wrong with your order and there is',
    'nothing more to pay — we just need somewhere to send it.',
    '',
    'You can put it right yourself here:',
    url,
    '',
    // The button's name is kept whole on one line. Wrapped across a break it
    // stops being something she can scan the page for, which is the entire job
    // this sentence has.
    'Sign in with the phone number or email you ordered with,',
    'then use "Change delivery address" on the order.',
    '',
    'Please do it as soon as you can: the address can only be changed once, and',
    'only until the parcel is dispatched.',
    '',
    brandConfig(brand).tagline,
  ].join('\n')

  const html = `<p>Hi ${escapeHtml(greeting)},</p>
<p>We are getting order <strong>${escapeHtml(orderNo)}</strong> ready to send, but we do not have a delivery address we can ship it to. Nothing is wrong with your order and there is nothing more to pay &mdash; we just need somewhere to send it.</p>
<p>You can put it right yourself here:</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>Sign in with the phone number or email you ordered with, then use <strong>Change delivery address</strong> on the order.</p>
<p>Please do it as soon as you can: the address can only be changed once, and only until the parcel is dispatched.</p>
<p>${escapeHtml(brandConfig(brand).tagline)}</p>`

  return { subject, text, html }
}

/**
 * Ask the customer to correct the delivery address on one order, once.
 *
 * Returns `null` when there is no such order, or when there is nothing to ask
 * her to do — an unopened, spent or too-late window, or a guest order she
 * could never sign in to. Those are not failures and must not be reported as
 * ones: the caller has just written a grant and wants to know whether a
 * message went out, and "no message, because there is nothing for her to do"
 * is a complete answer.
 *
 * ── The dedupe key is per GRANT, not per order ──────────────────────────────
 * `order-address-change:<orderNo>` would be wrong. Support closing a window
 * and opening a second one is a deliberate act — the console asks them to
 * confirm it — and it exists exactly for the customer who got it wrong the
 * first time. Under a per-order key that second grant would be silently
 * deduped away and she would never hear about it. `setOrderAddressEditGrant`
 * stamps a fresh `addressEditGrantedAt` on every grant, so keying on it gives
 * one message per grant, and a retry of THIS grant still converges on one.
 */
export async function sendAddressChangeRequest(
  brand: Brand,
  orderNo: string,
): Promise<AddressChangeNotifyResult | null> {
  try {
    const prisma = dbFor(brand)
    const order = await prisma.order.findUnique({
      where: { orderNo },
      select: {
        status: true,
        userId: true,
        addressEditGrantedAt: true,
        addressEditUsedAt: true,
        user: { select: { name: true, email: true, phone: true } },
        address: { select: { name: true, phone: true } },
      },
    })
    if (!order) return null

    // Never send an invitation to do something she will be refused. The window
    // is checked here, not trusted from the caller, because the caller's write
    // and this read are two statements and an order can be dispatched between
    // them — and "correct your address" for a parcel already on a van is the
    // single worst message this platform could send.
    const state = addressEditState(order)
    if (!state.open || !order.addressEditGrantedAt) return null

    /*
     * A guest order cannot use this flow AT ALL.
     *
     * `getOrderAddressEditState` and `updateOrderAddress` both scope by
     * `userId`, and `Order.userId` is nullable — a guest checkout has no user
     * row. There is no session she could sign in with that owns this order, so
     * the control would never render however long the window stayed open.
     * Saying so up front is what stops support opening a window, seeing no
     * message go out, and assuming the notification is broken.
     */
    if (!order.userId) {
      logger.warn('order_address_change_guest_order', { orderNo })
      // Reported rather than returned as `null`, so the console SAYS this on
      // the screen where the operator just clicked. Silence here is what would
      // have them wait for a correction that can never arrive.
      return {
        url: orderPageUrl(brand, orderNo),
        email: { sent: false, reason: null },
        whatsapp: { sent: false, reason: null },
        unreachable: true,
        blocked: 'guest-order',
      }
    }

    const url = orderPageUrl(brand, orderNo)
    // First name only, matching the order messages. Falls back to the address
    // name for an account with none, then to a neutral greeting — an empty
    // WhatsApp body parameter is rejected outright by Meta.
    const greeting =
      order.user?.name?.trim().split(' ')[0] ||
      order.address?.name?.trim().split(' ')[0] ||
      'there'
    // One key per grant — see the note above. Milliseconds, because a grant and
    // a re-grant seconds apart are two different asks.
    const grantKey = order.addressEditGrantedAt.getTime()

    const email = await sendEmail(brand, {
      orderNo,
      userId: order.userId,
      to: order.user?.email?.trim() || null,
      greeting,
      url,
      grantKey,
    })

    const whatsapp = await sendWhatsapp(brand, {
      orderNo,
      userId: order.userId,
      // Same fallback as `order-whatsapp.ts`, and for the same reason: this is
      // a message about a parcel, and the address phone is the number the
      // courier would already be calling. She still has to sign in as the
      // account holder to save, which the guard above has already established
      // she can.
      to: order.user?.phone?.trim() || order.address?.phone?.trim() || null,
      greeting,
      url,
      grantKey,
    })

    const unreachable = !email.sent && !whatsapp.sent
    if (unreachable) {
      // The one outcome that needs a human. Logged as well as returned,
      // because the console shows it to whoever clicked and nobody else.
      logger.warn('order_address_change_unreachable', {
        orderNo,
        email: email.reason,
        whatsapp: whatsapp.reason,
      })
    }
    return { url, email, whatsapp, unreachable, blocked: null }
  } catch (err) {
    // Reaching here means the READ failed — both sends swallow their own
    // provider errors. The grant is already written and stands.
    logger.error('order_address_change_failed', { orderNo, err: String(err) })
    return null
  }
}

async function sendEmail(
  brand: Brand,
  input: {
    orderNo: string
    userId: string
    to: string | null
    greeting: string
    url: string
    grantKey: number
  },
): Promise<AddressChangeChannelResult> {
  if (!input.to) return { sent: false, reason: 'no-email' }

  const copy = renderAddressChangeEmail({
    brand,
    greeting: input.greeting,
    orderNo: input.orderNo,
    url: input.url,
  })

  const result = await sendEmailNotification(brand, {
    userId: input.userId,
    to: input.to,
    subject: copy.subject,
    text: copy.text,
    html: copy.html,
    template: 'order-address-change',
    dedupeKey: `order-address-change:${input.orderNo}:${input.grantKey}`,
  })
  return result.sent ? { sent: true, reason: null } : { sent: false, reason: 'send-failed' }
}

async function sendWhatsapp(
  brand: Brand,
  input: {
    orderNo: string
    userId: string
    to: string | null
    greeting: string
    url: string
    grantKey: number
  },
): Promise<AddressChangeChannelResult> {
  const template = addressChangeTemplateName()
  // Checked BEFORE the recipient, so the reason names the thing that is
  // actually missing. Every customer looks unreachable by WhatsApp until the
  // template is approved, and "no phone on file" would send support looking at
  // the customer record for a problem that is in the WABA.
  if (!template) return { sent: false, reason: 'template-not-approved' }
  if (!input.to) return { sent: false, reason: 'no-phone' }

  const result = await sendWhatsappNotification(brand, {
    userId: input.userId,
    to: input.to,
    template,
    // {{1}} name, {{2}} order number, {{3}} link — the shape the template must
    // be approved with. See addressChangeTemplateName for what a mismatch does.
    params: [input.greeting, input.orderNo, input.url],
    dedupeKey: `wa-order-address-change:${input.orderNo}:${input.grantKey}`,
  })
  return result.sent ? { sent: true, reason: null } : { sent: false, reason: 'send-failed' }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

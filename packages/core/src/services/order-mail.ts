import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../brands'
import { logger } from '../logger'
import { sendEmailNotification } from './notifications'

/**
 * Order lifecycle emails.
 *
 * Until this existed the customer heard nothing after paying: `sendEmailNotification`
 * had exactly two callers (a partner ops alert and a reward redemption), and
 * neither was on the order path. Money left her account and the only confirmation
 * was the browser tab she happened to be looking at.
 *
 * Two deliberate choices:
 *  - The recipient is read from the ORDER'S USER, not the shipping address. The
 *    address holds whoever is receiving the parcel; the account holds whoever
 *    paid and is entitled to the receipt.
 *  - Every send is keyed `order-<status>:<orderNo>` on NotificationLog.dedupeKey,
 *    which is @unique. The Razorpay webhook, the synchronous verify call and the
 *    reconcile cron can all mark the same order paid, so idempotency is not
 *    optional — without it a shopper gets three identical receipts.
 */

const money = (rupees: number) => `Rs.${rupees.toLocaleString('en-IN')}`

/**
 * The subject lines take the BRAND, because there is one set of templates and
 * two brands sending from them.
 *
 * These read `Your Femi9 order LM-00001 is confirmed` for every Lumi9 order —
 * a receipt for baby diapers, from a company the customer has never heard of,
 * signed off "organic period care". `sendOrderStatusEmail` has always taken
 * `brand`; it just never reached the copy.
 */
const COPY = {
  paid: {
    subject: (brand: Brand, orderNo: string) =>
      `Your ${brandConfig(brand).name} order ${orderNo} is confirmed`,
    lead: 'Thank you - your payment went through and we are getting your order ready.',
  },
  shipped: {
    subject: (brand: Brand, orderNo: string) =>
      `Your ${brandConfig(brand).name} order ${orderNo} is on its way`,
    lead: 'Good news - your order has left our warehouse.',
  },
} as const

export type OrderMailStatus = keyof typeof COPY

/**
 * Send the confirmation / dispatch email for an order, once.
 *
 * Never throws: an email provider outage must not roll back a captured payment
 * or block an admin's status change. Failures are logged and the NotificationLog
 * row records them for a retry.
 */
export async function sendOrderStatusEmail(brand: Brand, orderNo: string, status: OrderMailStatus): Promise<void> {
  const prisma = dbFor(brand)
  try {
    const order = await prisma.order.findUnique({
      where: { orderNo },
      select: {
        total: true,
        userId: true,
        user: { select: { email: true, name: true } },
        items: { select: { productName: true, variantLabel: true, qty: true, lineTotal: true } },
        address: { select: { name: true, line: true, city: true, state: true, pincode: true } },
      },
    })
    if (!order) return

    const to = order.user?.email?.trim()
    if (!to) {
      // A phone-only account has no address to write to. That is the identity
      // gap, not a mail bug — log it so the gap stays visible rather than
      // silently swallowing the receipt.
      logger.warn('order_mail_no_recipient', { orderNo, status })
      return
    }

    const copy = COPY[status]
    const greeting = order.user?.name?.trim().split(' ')[0] || 'there'
    const lines = order.items
      .map((it) => `${it.productName} - ${it.variantLabel} x${it.qty} - ${money(it.lineTotal)}`)
      .join('\n')
    const addr = order.address
      ? [order.address.name, order.address.line, order.address.city, order.address.state, order.address.pincode]
          .filter(Boolean)
          .join(', ')
      : ''

    const text = [
      `Hi ${greeting},`,
      '',
      copy.lead,
      '',
      `Order ${orderNo}`,
      lines,
      '',
      `Total paid: ${money(order.total)}`,
      addr ? `Shipping to: ${addr}` : '',
      '',
      brandConfig(brand).tagline,
    ]
      .filter((l) => l !== null)
      .join('\n')

    const html = `<p>Hi ${escapeHtml(greeting)},</p>
<p>${escapeHtml(copy.lead)}</p>
<p><strong>Order ${escapeHtml(orderNo)}</strong></p>
<ul>${order.items
      .map(
        (it) =>
          `<li>${escapeHtml(it.productName)} - ${escapeHtml(it.variantLabel)} &times;${it.qty} - ${money(it.lineTotal)}</li>`,
      )
      .join('')}</ul>
<p><strong>Total paid: ${money(order.total)}</strong></p>
${addr ? `<p>Shipping to: ${escapeHtml(addr)}</p>` : ''}
<p>${escapeHtml(brandConfig(brand).tagline)}</p>`

    await sendEmailNotification(brand, {
      userId: order.userId ?? undefined,
      to,
      subject: copy.subject(brand, orderNo),
      text,
      html,
      template: `order-${status}`,
      dedupeKey: `order-${status}:${orderNo}`,
    })
  } catch (err) {
    logger.error('order_mail_failed', { orderNo, status, err: String(err) })
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

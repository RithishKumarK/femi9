import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { logger } from '../logger'
import {
  invoiceTemplateName,
  uploadWhatsappDocument,
  WHATSAPP_TEMPLATES,
  type WhatsappDocument,
} from '../whatsapp'
import { generateInvoicePdf } from './invoice'
import { sendWhatsappNotification } from './notifications'

/**
 * Order lifecycle WhatsApp messages.
 *
 * The sibling of `order-mail.ts`, and it exists for the gap that file documents:
 * the receipt goes to `order.user.email`, which is NULL for every phone-only
 * signup — and phone-only is the default way into both storefronts. Those
 * customers paid and then heard nothing at all. WhatsApp reaches exactly them.
 *
 * Three deliberate choices:
 *
 *  - Only the three APPROVED templates are sent. There is no WhatsApp template
 *    for `shipped`, so dispatch stays email-only; do not squeeze it into the
 *    delivered template, whose body says the order "has been" completed.
 *
 *  - The recipient falls back to the SHIPPING ADDRESS phone when the account has
 *    none. That is the opposite of order-mail's rule, and on purpose: mail is a
 *    receipt and belongs to whoever paid, whereas these messages are about a
 *    parcel, a guest checkout has no user row at all, and the address phone is
 *    the number the courier will already be calling.
 *
 *  - Every send is keyed `wa-order-<status>:<orderNo>` on NotificationLog's
 *    @unique dedupeKey. The webhook, the verify call and the reconcile cron can
 *    all mark one order paid; without the key a shopper gets three confirmations.
 */

const money = (rupees: number) => `Rs.${rupees.toLocaleString('en-IN')}`

/** Which approved template each order event maps to. */
export type OrderWhatsappStatus = 'paid' | 'delivered' | 'cancelled'

/**
 * Send the WhatsApp message for an order event, once.
 *
 * Never throws: Meta being down must not roll back a captured payment or block
 * an admin's status change. Failures land on the NotificationLog row, which is
 * what a retry would read.
 */
export async function sendOrderStatusWhatsapp(
  brand: Brand,
  orderNo: string,
  status: OrderWhatsappStatus,
): Promise<void> {
  try {
    const prisma = dbFor(brand)
    const order = await prisma.order.findUnique({
      where: { orderNo },
      select: {
        total: true,
        userId: true,
        user: { select: { name: true, phone: true } },
        items: { select: { productName: true, variantLabel: true, qty: true, lineTotal: true } },
        address: { select: { name: true, phone: true } },
      },
    })
    if (!order) return

    const to = order.user?.phone?.trim() || order.address?.phone?.trim() || ''
    if (!to) {
      // An email-only account that shipped to an address with no phone. Rare,
      // and worth seeing rather than swallowing — the email path still ran.
      logger.warn('order_whatsapp_no_recipient', { orderNo, status })
      return
    }

    // {customername}. First name only — the template greets her by it, and
    // "Dear Priya Sharma," reads like a bank letter. Falls back to the address
    // name for a guest order, then to a neutral greeting rather than an empty
    // parameter, which Meta rejects outright.
    const customerName =
      order.user?.name?.trim().split(' ')[0] ||
      order.address?.name?.trim().split(' ')[0] ||
      'there'

    if (status === 'paid') {
      // {orderproductlist} must be ONE line: Meta rejects a body parameter
      // containing a newline, so the list is separated by semicolons rather
      // than laid out the way the email lays it out.
      const productList = order.items
        .map((it) => `${it.productName} - ${it.variantLabel} x${it.qty} - ${money(it.lineTotal)}`)
        .join('; ')

      const params = [customerName, orderNo, productList, money(order.total)]
      // ONE key for both attempts below. The invoice-carrying template and the
      // body-only fallback are two attempts to send the SAME confirmation, and
      // a second key would put two of them on her phone.
      const dedupeKey = `wa-order-paid:${orderNo}`

      /*
       * Attach the receipt when there is a template approved to carry one.
       *
       * `attachReceipt` returns null for every reason there is - no approved
       * template, a PDF that would not render, an upload Meta refused - and
       * each one falls through to the body-only confirmation that has always
       * been sent. That ordering is the whole point: the message is what she
       * needs, the PDF is what makes it nicer, and a missing attachment must
       * never cost her the notification that her payment went through.
       */
      const invoiceTemplate = invoiceTemplateName()
      if (invoiceTemplate) {
        const document = await attachReceipt(brand, orderNo)
        if (document) {
          const withInvoice = await sendWhatsappNotification(brand, {
            userId: order.userId ?? undefined,
            to,
            template: invoiceTemplate,
            params,
            document,
            dedupeKey,
          })
          if (withInvoice.sent) return
          // Fell through: the row is now `failed` under this key, which is what
          // lets the plain send below reuse it rather than being deduped away.
          logger.warn('order_whatsapp_invoice_fallback', { orderNo, template: invoiceTemplate })
        }
      }

      await sendWhatsappNotification(brand, {
        userId: order.userId ?? undefined,
        to,
        template: WHATSAPP_TEMPLATES.orderConfirmation,
        params,
        dedupeKey,
      })
      return
    }

    if (status === 'delivered') {
      // The third variable is {status}; the template reads "has been {status}!"
      await sendWhatsappNotification(brand, {
        userId: order.userId ?? undefined,
        to,
        template: WHATSAPP_TEMPLATES.orderDelivered,
        params: [customerName, orderNo, 'delivered'],
        dedupeKey: `wa-order-delivered:${orderNo}`,
      })
      return
    }

    await sendWhatsappNotification(brand, {
      userId: order.userId ?? undefined,
      to,
      template: WHATSAPP_TEMPLATES.orderCancelled,
      params: [customerName, orderNo],
      dedupeKey: `wa-order-cancelled:${orderNo}`,
    })
  } catch (err) {
    logger.error('order_whatsapp_failed', { orderNo, status, err: String(err) })
  }
}

/**
 * Render the receipt and hand it to Meta, or give up quietly.
 *
 * Never throws and never returns a partial result: the caller's fallback is
 * only correct if "no document" is the single failure signal. pdf-lib throwing
 * on an unencodable character in a product name, an oversized PDF, a Graph
 * timeout - all of them are the same answer here, and all of them are logged
 * rather than swallowed, because a permanently-failing attachment looks exactly
 * like a working one from the outside.
 */
async function attachReceipt(brand: Brand, orderNo: string): Promise<WhatsappDocument | null> {
  try {
    const pdf = await generateInvoicePdf(brand, orderNo)
    if (!pdf) return null

    const mediaId = await uploadWhatsappDocument(brand, {
      bytes: pdf.bytes,
      filename: pdf.filename,
    })
    if (!mediaId) {
      logger.warn('order_whatsapp_media_upload_failed', { orderNo })
      return null
    }
    return { mediaId, filename: pdf.filename }
  } catch (err) {
    logger.error('order_whatsapp_invoice_render_failed', { orderNo, err: String(err) })
    return null
  }
}

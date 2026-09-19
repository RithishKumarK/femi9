import 'server-only'
import { mailConfigured, mailProviderFor } from '../mail-identity'
import { sendMail } from '../mailer'
import { dbFor, type Brand } from '@femi9/db'
import { configuredEnv, mockProvidersAllowed } from '../runtime-mode'
import {
  sendWhatsappTemplate,
  toWhatsappNumber,
  whatsappConfigured,
  type WhatsappDocument,
  type WhatsappTemplate,
} from '../whatsapp'

export interface EmailNotification {
  userId?: string
  to: string
  subject: string
  html: string
  text: string
  template: string
  dedupeKey: string
}

/** Idempotent, audited email delivery. Provider failures do not lose the log. */
export async function sendEmailNotification(brand: Brand, input: EmailNotification): Promise<{ sent: boolean; duplicate?: boolean }> {
  const prisma = dbFor(brand)
  const existing = await prisma.notificationLog.findUnique({ where: { dedupeKey: input.dedupeKey } })
  if (existing?.status === 'sent' || existing?.status === 'mocked') return { sent: true, duplicate: true }

  const log = existing ?? await prisma.notificationLog.create({
    data: {
      userId: input.userId,
      channel: 'email',
      recipient: input.to.trim().toLowerCase(),
      template: input.template,
      dedupeKey: input.dedupeKey,
      status: 'pending',
    },
  })

  // Per-brand credentials, falling back to the shared ones. Sending a Lumi9
  // order confirmation from Femi9's address would be wrong in the inbox and
  // bad for deliverability — see mail-identity.
  if (!mailConfigured(brand)) {
    if (!mockProvidersAllowed()) {
      // Name the provider the brand is SUPPOSED to use, not the one this file
      // used to hard-code. "Resend is not configured" sent whoever read it
      // looking for a key that Lumi9 does not have and does not need.
      const provider = mailProviderFor(brand) ?? 'no'
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', error: `${provider} mail provider is not configured for ${brand}` },
      })
      return { sent: false }
    }
    await prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'mocked', sentAt: new Date(), error: null } })
    return { sent: true }
  }

  try {
    // SES or Resend, decided per brand in mail-identity. This file no longer
    // knows which, and must not learn.
    await sendMail(brand, { to: input.to, subject: input.subject, html: input.html, text: input.text })
    await prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'sent', sentAt: new Date(), error: null } })
    return { sent: true }
  } catch (err) {
    await prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'failed', error: String(err).slice(0, 500) } })
    return { sent: false }
  }
}

export interface WhatsappNotification {
  userId?: string
  /** Any form of the customer's number — normalised by the transport. */
  to: string
  template: WhatsappTemplate
  /** Body variables, in the order the approved template declares them. */
  params: (string | number | null | undefined)[]
  /** A PDF for the template's document header, if it declares one. */
  document?: WhatsappDocument
  dedupeKey: string
}

/**
 * Idempotent, audited WhatsApp delivery — the mirror of the email path above,
 * onto the same NotificationLog table with `channel: 'whatsapp'`.
 *
 * The dedupe key is what makes this safe on the order path. A paid order can be
 * marked paid three times over — the Razorpay webhook, the synchronous verify
 * call and the reconcile cron all race for it — and without the unique key a
 * shopper gets three identical confirmations on her phone. The recipient is
 * stored normalised (91XXXXXXXXXX) so the log reads the same as what was sent.
 */
export async function sendWhatsappNotification(
  brand: Brand,
  input: WhatsappNotification,
): Promise<{ sent: boolean; duplicate?: boolean }> {
  const prisma = dbFor(brand)
  const existing = await prisma.notificationLog.findUnique({ where: { dedupeKey: input.dedupeKey } })
  if (existing?.status === 'sent' || existing?.status === 'mocked') return { sent: true, duplicate: true }

  const log = existing ?? await prisma.notificationLog.create({
    data: {
      userId: input.userId,
      channel: 'whatsapp',
      recipient: toWhatsappNumber(input.to) ?? input.to.trim(),
      template: input.template,
      dedupeKey: input.dedupeKey,
      status: 'pending',
    },
  })

  // A retry under the same key may be a DIFFERENT template from the one that
  // failed - the order path attempts the invoice-carrying template first and
  // falls back to the body-only one under the same dedupe key, which is what
  // stops the shopper getting two confirmations. Without this the row would
  // still name the template that never sent, and the audit trail would be a
  // record of a message that was not the one delivered.
  if (existing && existing.template !== input.template) {
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { template: input.template },
    })
  }

  if (!whatsappConfigured(brand)) {
    if (!mockProvidersAllowed()) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', error: 'WhatsApp is not configured' },
      })
      return { sent: false }
    }
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'mocked', sentAt: new Date(), error: null },
    })
    return { sent: true }
  }

  const result = await sendWhatsappTemplate(brand, {
    to: input.to,
    template: input.template,
    params: input.params,
    document: input.document,
  })
  if (!result.sent) {
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'failed', error: (result.reason ?? 'unknown').slice(0, 500) },
    })
    return { sent: false }
  }
  await prisma.notificationLog.update({
    where: { id: log.id },
    data: { status: result.mock ? 'mocked' : 'sent', sentAt: new Date(), error: null },
  })
  return { sent: true }
}
/**
 * Record what happened to a message AFTER the provider accepted it.
 *
 * A send is not a delivery. SES answers 200, queues the message, and only later
 * discovers that the mailbox is full, the domain does not exist, or the
 * recipient pressed "this is spam" — and every one of those arrives on the
 * event feed rather than on the call that sent it. Without this, `status`
 * stays `sent` forever and the log says every message the platform ever emitted
 * arrived, which is the most confidently wrong thing an audit log can say.
 *
 * It writes onto the existing rows rather than a new table: `status` is a free
 * string, so `bounced` and `complained` need no migration, and the row already
 * carries the recipient, the template and the send time.
 *
 * Scoped to `email` and to rows that were actually sent — a bounce cannot
 * retroactively describe a message that failed to send, and it must never
 * overwrite a `failed` row's error with a delivery status.
 */
export async function recordEmailDeliveryEvent(
  brand: Brand,
  recipient: string,
  status: 'bounced' | 'complained' | 'delivered',
  detail?: string,
): Promise<number> {
  const address = recipient.trim().toLowerCase()
  if (!address) return 0

  const { count } = await dbFor(brand).notificationLog.updateMany({
    where: {
      channel: 'email',
      recipient: address,
      status: 'sent',
      // A bounce refers to something recently sent. Without a window, a bounce
      // for one message rewrites the history of every message ever sent to that
      // address, including ones that demonstrably arrived.
      sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    data: { status, error: detail?.slice(0, 500) ?? null },
  })
  return count
}

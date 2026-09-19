import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { sendEmailNotification } from './notifications'
import { logger } from '../logger'

/**
 * Partner (reseller) lead capture — the storefront write path.
 *
 * The public "become a partner" form used to persist to localStorage, which
 * meant a submission never left the visitor's browser and the sales team had no
 * pipeline. This service turns each submission into a real PartnerApplication
 * lead so the admin CRM can work it (new → contacted → onboarded / rejected).
 *
 * Kept deliberately thin: it only creates the row (status defaults to `new` in
 * the schema). All admin-side reads/writes live in services/admin/partners.ts so
 * this public surface can never be used to enumerate or mutate existing leads.
 */

export interface CreateApplicationInput {
  name: string
  phone: string
  city: string
  // Optional free-text context — the situation dropdown and the "why" reason.
  situation?: string | null
  reason?: string | null
}

/** Persist a new partner lead. Status is left to the schema default (`new`). */
export async function createApplication(brand: Brand, input: CreateApplicationInput) {
  const prisma = dbFor(brand)
  const application = await prisma.partnerApplication.create({
    data: {
      name: input.name,
      phone: input.phone,
      city: input.city,
      // Normalise empty/blank optionals to null so "unset" isn't stored as ''.
      situation: input.situation?.trim() || null,
      reason: input.reason?.trim() || null,
    },
  })
  const opsEmail = process.env.PARTNER_OPS_EMAIL?.trim()
  if (opsEmail) {
    await sendEmailNotification(brand, {
      to: opsEmail,
      subject: `New Femi9 partner lead: ${application.name}`,
      text: `${application.name} (${application.phone}) applied from ${application.city}.`,
      html: `<p><strong>${application.name}</strong> (${application.phone}) applied from ${application.city}.</p>`,
      template: 'partner-application-ops',
      dedupeKey: `partner-application:${application.id}:ops`,
    })
  } else {
    // The lead is safely stored either way, but with no recipient configured
    // nobody is told it arrived — and the visitor has just been shown a
    // confirmation. Make that silence visible in the logs; the readiness
    // report also lists PARTNER_OPS_EMAIL as recommended for the same reason.
    logger.warn('partner_lead_no_ops_recipient', { applicationId: application.id })
  }
  return application
}

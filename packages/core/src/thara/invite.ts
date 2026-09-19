import 'server-only'
import { mailConfigured } from '../mail-identity'
import { sendMail } from '../mailer'
import { mockProvidersAllowed } from '../runtime-mode'

/**
 * Thara invite email — sender for referral invitations.
 *
 * Thara is a FEMI9 programme — `brandConfig('lumi9').modules` excludes it — so
 * this always sends as femi9, and the brand is not a parameter. It goes through
 * `mailer.ts` like every other message on the platform, which is what finally
 * makes the old promise in this comment ("a future switch from Resend to SES is
 * a single-file swap") true: that file is the single file, and Femi9 moving to
 * SES becomes a variable rather than an edit here.
 *
 *   configured per mail-identity → real send
 *   otherwise + ALLOW_MOCK_PROVIDERS=true → returns { mock: true } and does nothing
 */

const BRAND = 'femi9' as const

function configured(): boolean {
  return mailConfigured(BRAND)
}

export interface TharaInviteResult {
  mock: boolean
}

export class TharaInviteProviderNotConfiguredError extends Error {
  constructor() {
    super('Email provider is not configured for Thara invites.')
    this.name = 'TharaInviteProviderNotConfiguredError'
  }
}

interface RenderInput {
  referrerName: string | null
  referralCode: string
  referralUrl: string
}

/** Render a plain HTML invite. Kept inline (no template engine) so the whole
 *  path is auditable in one file. */
export function renderInviteEmail({ referrerName, referralCode, referralUrl }: RenderInput): {
  subject: string
  html: string
  text: string
} {
  const who = referrerName?.trim() || 'A friend'
  const subject = `${who} sent you an invite to try Femi9`
  const html =
    `<p>Hi,</p>` +
    `<p><strong>${who}</strong> uses Femi9 - organic, breathable period-care pads made in India - and wanted you to try them too.</p>` +
    `<p>Tap the button below to browse. Their code <strong>${referralCode}</strong> is applied automatically.</p>` +
    `<p><a href="${referralUrl}" style="display:inline-block;padding:12px 22px;border-radius:999px;` +
    `background:#5B3FDA;color:#fff;font-weight:600;text-decoration:none">Open Femi9</a></p>` +
    `<p style="color:#7F6EB9;font-size:13px">If you weren't expecting this, you can safely ignore this email - it was sent because ${who} shared your address with us for this invitation.</p>`
  const text =
    `${who} uses Femi9 and wanted you to try it too.\n\n` +
    `Their referral code is ${referralCode}. Open ${referralUrl} to browse.\n\n` +
    `If you weren't expecting this, ignore this email.`
  return { subject, html, text }
}

interface SendInput {
  to: string
  subject: string
  html: string
  text: string
}

/** Deliver an invite through Femi9's configured provider. Mock-safe when the
 *  flag allows it. */
export async function sendTharaInviteEmail(input: SendInput): Promise<TharaInviteResult> {
  if (!configured()) {
    if (!mockProvidersAllowed()) throw new TharaInviteProviderNotConfiguredError()
    return { mock: true }
  }
  await sendMail(BRAND, {
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  })
  return { mock: false }
}

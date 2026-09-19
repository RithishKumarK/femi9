import 'server-only'
import type { Brand } from '@femi9/db'
import { brandName, mailConfigured, mailProviderFor } from './mail-identity'
import { sendMail } from './mailer'
import { randomInt, randomBytes, createHash } from 'node:crypto'
import {
  configuredEnv,
  mockProvidersAllowed,
  ProviderConfigurationError,
} from './runtime-mode'

/**
 * OTP / magic-link delivery seam.
 *
 * The ONLY place that knows how to mint one-time secrets and hand them to a
 * provider. An explicit non-production mock flag makes sends a NO-OP and lets
 * the caller surface the code/link for local testing. Production fails closed
 * when a provider is missing or still has a Terraform TODO value. node:crypto
 * keeps every consumer of this module in the Node runtime (not edge).
 */

/** Live SMS only when the MSG91 key is present; empty in dev → mock mode. */
export function smsConfigured(): boolean {
  return configuredEnv('MSG91_AUTH_KEY') && configuredEnv('MSG91_TEMPLATE_ID')
}

/** Live email only when the Resend key is present; empty in dev → mock mode. */
export function emailConfigured(): boolean {
  return configuredEnv('RESEND_API_KEY') && configuredEnv('EMAIL_FROM')
}

/** A 6-digit numeric code from a CSPRNG (randomInt), zero-padded so leading
 *  zeros survive — "007123" must stay six chars for the hash to round-trip. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** A high-entropy opaque token for magic links (32 bytes hex). Random, so two
 *  links never collide on VerificationToken.token (which is globally @unique). */
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/** SHA-256 hex of the input. We persist only the HASH of a code/token, never the
 *  raw secret, so a leaked VerificationToken row can't be replayed. */
export function hashCode(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Whether a send actually left the building (false) or was mocked (true). */
export interface SendResult {
  mock: boolean
}

/**
 * Send the OTP `code` to `phone` over SMS.
 *
 * MOCK: explicit local/test mode does nothing and reports mock:true; the caller
 * returns the code as a dev field. LIVE: post our own OTP to MSG91's v5 endpoint
 * (India numbers, so prefixed with 91). Throws on a non-2xx.
 */
export async function sendSms(phone: string, code: string): Promise<SendResult> {
  if (!smsConfigured()) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError('MSG91')
    return { mock: true }
  }

  const authKey = process.env.MSG91_AUTH_KEY as string
  const url = new URL('https://control.msg91.com/api/v5/otp')
  url.searchParams.set('otp', code)
  url.searchParams.set('mobile', `91${phone}`)
  // DLT template id is required by MSG91 in production; supplied via env when the
  // sender account is provisioned. Left off in the (never-reached-here) no-key case.
  url.searchParams.set('template_id', process.env.MSG91_TEMPLATE_ID as string)

  const res = await fetch(url, {
    method: 'POST',
    headers: { authkey: authKey, 'content-type': 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`MSG91 sendSms failed (${res.status}): ${detail}`)
  }
  return { mock: false }
}

/** What happened to a non-OTP SMS. `sent:false` with a reason is an honest
 *  "we could not tell her", which callers log rather than swallow. */
export interface SmsSendResult {
  sent: boolean
  mock: boolean
  reason?: string
}

/**
 * Send a plain transactional SMS (not an OTP challenge).
 *
 * This exists because a phone-only customer had no way to receive her redeemed
 * reward code: the only delivery was email, guarded by `if (user.email)`, which
 * is null for every OTP signup. MSG91's OTP endpoint cannot carry arbitrary
 * text, so this posts to the flow endpoint, which needs its own DLT-approved
 * template. When that template is not provisioned we report it honestly instead
 * of pretending the message went out.
 */
export async function sendTextSms(
  phone: string,
  variables: Record<string, string>,
): Promise<SmsSendResult> {
  const flowTemplate = process.env.MSG91_FLOW_TEMPLATE_ID?.trim()
  if (!smsConfigured() || !flowTemplate) {
    if (mockProvidersAllowed()) return { sent: true, mock: true }
    return { sent: false, mock: false, reason: 'MSG91_FLOW_TEMPLATE_ID is not configured' }
  }

  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: process.env.MSG91_AUTH_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({
      template_id: flowTemplate,
      recipients: [{ mobiles: `91${phone}`, ...variables }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { sent: false, mock: false, reason: `MSG91 flow failed (${res.status}): ${detail.slice(0, 200)}` }
  }
  return { sent: true, mock: false }
}

/**
 * Email a sign-in `url` to `email`.
 *
 * MOCK: explicit local/test mode does nothing and reports mock:true; the caller
 * returns the link as a dev field. LIVE: sent through whichever provider the
 * brand is configured for — SES for Lumi9, Resend for Femi9 — by `mailer.ts`.
 * Throws when the provider refuses, because the caller tells the shopper to go
 * and look in her inbox.
 */
export async function sendMagicLink(brand: Brand, email: string, url: string): Promise<SendResult> {
  if (!mailConfigured(brand)) {
    if (!mockProvidersAllowed()) throw new ProviderConfigurationError(mailProviderFor(brand) ?? 'email')
    return { mock: true }
  }

  // The copy carries the brand too. A Lumi9 parent receiving a Femi9-branded
  // sign-in link reads as phishing, not as a sibling company.
  const name = brandName(brand)
  await sendMail(brand, {
    to: email,
    subject: `Your ${name} sign-in link`,
    html:
      `<p>Tap the button below to sign in to ${name}. This link expires in 15 minutes.</p>` +
      `<p><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:999px;` +
      `background:#F0C14E;color:#34204E;font-weight:600;text-decoration:none">Sign in to ${name}</a></p>` +
      `<p>If you didn't request this, you can safely ignore this email.</p>`,
    // A sign-in link with no plain-text part is the single most spam-filtered
    // shape a transactional email can have, and this one has to arrive.
    text:
      `Sign in to ${name} using this link, which expires in 15 minutes:\n\n${url}\n\n` +
      `If you didn't request this, you can safely ignore this email.`,
  })
  return { mock: false }
}

import type { Brand } from '@femi9/db'
import { brandConfig } from './brands'
import { perBrandEnv, usableEnv } from './env-identity'

/**
 * Which mail identity a brand sends under.
 *
 * Transactional mail is the most brand-visible thing the platform does — a
 * Lumi9 parent receiving a Femi9-branded sign-in link is confusing at best, and
 * at worst reads as phishing. So the FROM address and the copy are per brand
 * even while the provider account is shared.
 *
 * ── The fallback is deliberate and temporary ────────────────────────────────
 * Each setting is read per brand first and falls back to the shared variable,
 * exactly as `dbFor` falls back to `DATABASE_URL`. That is what lets Lumi9 run
 * on Femi9's Resend credentials today and move to its own by setting one
 * variable, with no code change. The resolver itself lives in `env-identity.ts`
 * now — WhatsApp and Razorpay want the same rule, and it must not be reimplemented.
 *
 * The KEY may reasonably stay shared — one Resend account can send for several
 * verified domains. The FROM address should not: it must be a domain that brand
 * has verified, or delivery suffers and the mail looks wrong.
 *
 * ── Two providers, chosen per brand ────────────────────────────────────────
 * Lumi9 sends through Amazon SES; Femi9 is live on Resend and stays there until
 * somebody decides otherwise. Both are real, both are supported, and which one
 * a brand uses is `MAIL_PROVIDER_<BRAND>` — a deliberate setting rather than a
 * consequence of which credential happens to be present.
 *
 * That explicitness is load-bearing. Lumi9's task inherits the SHARED
 * `RESEND_API_KEY` (Femi9's account, for the brands that still need it), so
 * "whichever credential we can find" would have silently sent every Lumi9
 * sign-in link through Femi9's Resend account, from a domain that account has
 * not verified. The provider is named, and mail-identity is the only place that
 * names it.
 *
 * SES needs no key here at all: the task assumes an IAM role that is allowed to
 * send as one identity (infra/terraform/ses.tf), so the credential is the role
 * and there is nothing to leak into an environment variable.
 */

/** `RESEND_API_KEY_LUMI9`, else the shared `RESEND_API_KEY`. */
export function resendKeyFor(brand: Brand): string | undefined {
  const key = perBrandEnv('RESEND_API_KEY', brand)
  return usableEnv(key) ? key : undefined
}

/** `EMAIL_FROM_LUMI9`, else the shared `EMAIL_FROM`. */
export function emailFromFor(brand: Brand): string | undefined {
  const from = perBrandEnv('EMAIL_FROM', brand)
  return usableEnv(from) ? from : undefined
}

/** Which transport this brand sends through. */
export type MailProvider = 'ses' | 'resend'

/**
 * `MAIL_PROVIDER_LUMI9`, else the shared `MAIL_PROVIDER`, else inferred.
 *
 * The inference exists so that nothing which worked before this module gained a
 * second provider stops working: a brand with a Resend key and no stated
 * provider keeps using Resend, exactly as it did. An unrecognised value is
 * ignored rather than throwing — a typo in a task definition must not take a
 * storefront out of the load balancer for the sake of a setting whose only
 * failure mode is sending through the wrong account.
 */
export function mailProviderFor(brand: Brand): MailProvider | undefined {
  const stated = perBrandEnv('MAIL_PROVIDER', brand)?.toLowerCase()
  if (stated === 'ses' || stated === 'resend') return stated

  if (resendKeyFor(brand)) return 'resend'
  // SES carries no key, so there is nothing to detect but the intent to use it.
  // Without a stated provider and without a Resend key, a brand cannot send.
  return undefined
}

/**
 * The SES configuration set every message is sent under, when there is one.
 *
 * Not decoration: the config set is what routes bounces and complaints to SNS,
 * and what publishes the reputation metrics that say whether SES is about to
 * pause the account. Sending outside it delivers the mail and loses the
 * feedback, which is the failure that is invisible until sending stops
 * altogether.
 */
export function sesConfigurationSetFor(brand: Brand): string | undefined {
  return perBrandEnv('SES_CONFIGURATION_SET', brand)
}

/** Which region's SES endpoint to call. Falls back to the task's own region. */
export function sesRegionFor(brand: Brand): string | undefined {
  return (
    perBrandEnv('SES_REGION', brand) ??
    process.env.AWS_REGION?.trim() ??
    process.env.AWS_DEFAULT_REGION?.trim() ??
    undefined
  )
}

/**
 * Where a REPLY goes, when that is not the From address.
 *
 * Transactional mail sends from a no-reply address that nobody watches, and a
 * parent who hits reply on an order confirmation is not doing anything unusual.
 * Without this her message goes nowhere and she hears nothing back — the same
 * shape as the contact form that showed a green tick and discarded the message.
 */
export function replyToFor(brand: Brand): string | undefined {
  return perBrandEnv('EMAIL_REPLY_TO', brand)
}

/** True when this brand can actually send. */
export function mailConfigured(brand: Brand): boolean {
  if (!emailFromFor(brand)) return false
  const provider = mailProviderFor(brand)
  if (provider === 'ses') return true
  if (provider === 'resend') return Boolean(resendKeyFor(brand))
  return false
}

/** The name to put in the subject line and the button. */
export function brandName(brand: Brand): string {
  return brandConfig(brand).name
}

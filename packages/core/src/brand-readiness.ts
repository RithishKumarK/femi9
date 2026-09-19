import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { mailConfigured, mailProviderFor } from './mail-identity'
import { paymentsConfigured, webhookConfiguredFor } from './payment-identity'
import { configuredEnv } from './runtime-mode'
import { whatsappConfigured } from './whatsapp'

/**
 * Is this brand configured well enough to serve traffic?
 *
 * ── Why this exists next to production-readiness.ts ─────────────────────────
 * That module audits a fixed list of bare env names — DATABASE_URL, MSG91_*,
 * RESEND_API_KEY. It is Femi9's audit, and it is correct for Femi9. It cannot
 * answer the question for a second brand, because a brand's settings may be
 * per-brand (`RESEND_API_KEY_LUMI9`) or inherited from the shared fallback, and
 * a bare-name check sees neither distinction. Asking `mailConfigured('lumi9')`
 * asks the same resolver the running code asks, so the probe and the app can
 * never disagree about whether mail is set up.
 *
 * ── What blocks, and what only warns ───────────────────────────────────────
 * Blocking means the ALB pulls the task out of service and an ECS deployment
 * stalls. That is the right outcome for a brand that cannot reach its database
 * or cannot sign a session — every request would fail anyway, and failing the
 * health check keeps the old, working tasks serving. It is the wrong outcome
 * for a missing webhook secret: the storefront still browses, still adds to
 * cart, still signs people in. Taking it out of the load balancer would convert
 * a degraded feature into an outage.
 */

export interface BrandReadiness {
  /** Reachability of this brand's schema. */
  db: boolean
  /** Absent settings that make the task unsafe to serve. */
  blocking: string[]
  /** Absent settings that switch a feature off but leave the site usable. */
  warnings: string[]
}

/** Only audit configuration in production — a dev box is expected to be sparse. */
function inProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export async function brandReadiness(brand: Brand): Promise<BrandReadiness> {
  const upper = brand.toUpperCase()

  // A trivially cheap query that still proves the schema is reachable AND
  // migrated: `product` exists only after migrations have run, so a fresh
  // database that was created but never migrated reports unhealthy rather
  // than quietly serving an empty catalogue.
  let db = false
  try {
    await dbFor(brand).product.count()
    db = true
  } catch (err) {
    console.error(`[health] ${brand} db check failed`, err)
  }

  const blocking: string[] = []
  const warnings: string[] = []

  if (inProduction()) {
    // Sessions are signed with this; without it nobody can stay signed in and
    // every cookie the task issues is unverifiable.
    if (!process.env.AUTH_SECRET?.trim()) blocking.push('AUTH_SECRET')

    // Checkout is the point of the site. A brand that cannot create a charge
    // should not be taking traffic.
    if (!paymentsConfigured(brand)) blocking.push(`RAZORPAY_KEY_ID_${upper} / RAZORPAY_KEY_SECRET_${upper}`)

    // For a ONE-OFF order this is degraded but not broken: the order is marked
    // paid by the browser callback alone, which still works.
    //
    // For a SUBSCRIPTION it is total. A mandate debits on Razorpay's schedule
    // with no browser anywhere near it, and `subscription.charged` is the only
    // notification that it happened — so an unverifiable webhook means every
    // recurring charge is taken from a customer's account and no order is ever
    // created for it. Money in, nothing shipped, nothing logged.
    //
    // Still a warning rather than blocking, on this file's standing reasoning:
    // pulling the task out of the load balancer turns a broken feature into a
    // site-wide outage. But it is the most expensive warning here.
    if (!webhookConfiguredFor(brand)) {
      warnings.push(`RAZORPAY_WEBHOOK_SECRET_${upper}(subscription-charges-unrecorded)`)
    }

    // Sign-in is by emailed link, so no mail means no new sessions — but
    // browsing, and every already-signed-in shopper, is unaffected.
    //
    // The warning names what is actually missing for THIS brand's provider.
    // "RESEND_API_KEY_LUMI9" sent whoever read it looking for a key Lumi9 does
    // not have and does not need: it sends through SES, where the credential is
    // the task role and the only thing an environment can get wrong is the
    // From address.
    if (!mailConfigured(brand)) {
      const provider = mailProviderFor(brand)
      warnings.push(
        provider === 'ses'
          ? `EMAIL_FROM_${upper} (SES)`
          : provider === 'resend'
            ? `RESEND_API_KEY_${upper} / EMAIL_FROM_${upper}`
            : `MAIL_PROVIDER_${upper} (no provider chosen, and no RESEND_API_KEY to infer one from)`,
      )
    }

    // Phone OTP is delivered ONLY over WhatsApp, and it is the primary sign-in
    // for both storefronts. Still a warning rather than blocking, on the same
    // reasoning as mail: the emailed link is a second way in, and taking the
    // task out of the load balancer would turn a lost sign-in method into a
    // full outage. It also silences the order confirmations that are the only
    // thing a phone-only customer hears after paying.
    if (!whatsappConfigured(brand)) {
      warnings.push(`WHATSAPP_TOKEN_${upper} / WHATSAPP_PHONE_NUMBER_ID_${upper}`)
    }

    // Without this, every `/api/cron/*` route refuses every caller and no
    // scheduled job runs: a legacy pay-later subscription ships one box and then
    // nothing, a customer who skips ONE delivery is paused permanently because
    // `resume-subscriptions` never runs, and an order whose webhook was missed
    // sits `pending` forever holding its stock. A WARNING, not blocking — the
    // storefront serves perfectly well without it, which is exactly why nobody
    // notices. cronSecretOk() treats Terraform's "TODO-" placeholder as unset,
    // so `configuredEnv` is the right test here.
    if (!configuredEnv('CRON_SECRET')) warnings.push('CRON_SECRET(scheduled-jobs-disabled)')
  }

  return { db, blocking, warnings }
}

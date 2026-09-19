import type { Brand } from '@femi9/db'
import { brandConfig } from './brands'

/**
 * Per-brand environment resolution: `NAME_LUMI9` first, then the shared `NAME`.
 *
 * Lifted out of mail-identity.ts because it is not about mail — Resend, Razorpay
 * and now WhatsApp all resolve their credentials the same way, and a second copy
 * of this rule is a second place for the placeholder bug below to come back.
 */

/**
 * Treat Terraform's initial `TODO-...` values exactly like missing configuration.
 *
 * This is applied to the PER-BRAND value inside `perBrandEnv`, not by callers,
 * and that placement is the whole point — see the note there.
 */
export function usableEnv(value: string | undefined): value is string {
  return Boolean(value && !/^TODO(?:[-_:]|\b)/i.test(value))
}

/**
 * `NAME_<BRAND>`, else the shared `NAME`, else undefined.
 *
 * The `usable` check runs on the specific value BEFORE the fallback is
 * consulted. It used to read `if (specific) return specific`, which looks
 * equivalent and is not: Terraform seeds each per-brand secret with a "TODO-"
 * placeholder, and a placeholder is a non-empty string. So the specific value
 * won, the shared fallback was never consulted, and the caller then rejected
 * the TODO and got undefined. The placeholder SHADOWED a working shared key
 * rather than deferring to it — the exact opposite of what it is for.
 *
 * Deployed, that meant Lumi9's health check reported `RAZORPAY_KEY_ID_LUMI9`
 * missing while a perfectly good shared `RAZORPAY_KEY_ID` sat one line below,
 * and the task never passed its ALB health check.
 */
export function perBrandEnv(name: string, brand: Brand): string | undefined {
  const specific = process.env[`${name}_${brand.toUpperCase()}`]?.trim()
  if (usableEnv(specific)) return specific

  const shared = process.env[name]?.trim()
  return usableEnv(shared) ? shared : undefined
}

/**
 * The public origin of a brand's STOREFRONT — for a link that has to survive
 * being read in an inbox or on a phone.
 *
 * `NEXT_PUBLIC_SITE_URL` is the wrong variable for this, and wrong quietly.
 * The console serves BOTH brands from one container with one environment, so a
 * single site URL there would hand every customer of both brands the same
 * origin — a Lumi9 mother sent to Femi9's storefront. In practice the console
 * sets no such variable at all, which is worse in a different way: the link
 * becomes a bare path, and a bare path in an email resolves to nothing.
 *
 * So the origin comes from the BRAND, which is a fact about the brand rather
 * than about the process that happens to be sending. `STOREFRONT_URL_<BRAND>`
 * overrides it for staging, where neither storefront is on its production
 * domain.
 *
 * The override is deliberately NOT read through `perBrandEnv`: that falls back
 * to a shared `STOREFRONT_URL`, which is precisely the one-origin-for-both-
 * brands failure this function exists to prevent. A brand with no override of
 * its OWN falls back to its own host, never to the other brand's link.
 */
export function storefrontOrigin(brand: Brand): string {
  const override = process.env[`STOREFRONT_URL_${brand.toUpperCase()}`]?.trim().replace(/\/+$/, '')
  return usableEnv(override) ? override : `https://${brandConfig(brand).host}`
}

import 'server-only'
import { Prisma, type User } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { generateCode, generateToken, hashCode, sendMagicLink } from '../otp'
import { WHATSAPP_TEMPLATES, sendWhatsappTemplateOrThrow } from '../whatsapp'
import type { GoogleProfile } from '../google-oauth'
import { rateLimit } from '../rate-limit'
import { ProviderConfigurationError } from '../runtime-mode'
import { logger } from '../logger'

/**
 * Customer auth service — the challenge lifecycle for phone-OTP and email
 * magic-link sign in. It owns the VerificationToken table and the User upsert;
 * it never touches cookies (the route mints the session so the Set-Cookie lands
 * on the right response).
 *
 * We reuse Auth.js's VerificationToken model as a generic single-use challenge
 * store, namespacing the identifier by channel ("otp:<phone>" / "email:<email>")
 * so the two flows can't collide. Only the HASH of a code/token is persisted —
 * see the salted-hash note on requestOtp for why the phone is folded in.
 */

// Short-lived by design: an OTP is a live conversation, a link is checked from an
// inbox a little later. Both are single-use regardless (consumed on success).
//
// FIVE minutes, and it KNOWINGLY DISAGREES with the WhatsApp copy. Both approved
// templates read "This code is valid for 10 minutes"; that copy is approved by
// Meta and is not ours to edit, and the shorter window was kept deliberately
// rather than widened to match it. So a shopper who takes the message at its
// word and returns at minute seven is told her code is invalid — a real,
// accepted cost, not an oversight.
//
// Do not "fix" this by moving either number. The app's own screens say five,
// which is what she sees while she is actually waiting; closing the gap for good
// means getting the template copy changed, and only then this line.
const OTP_TTL_MS = 5 * 60 * 1000
const LINK_TTL_MS = 15 * 60 * 1000

/** Bad phone shape. Route maps to 400. */
export class InvalidPhoneError extends Error {
  constructor() {
    super('Enter a valid 10-digit mobile number.')
    this.name = 'InvalidPhoneError'
  }
}

/** Wrong / expired / already-used OTP. Route maps to 400. Intentionally vague —
 *  we don't tell an attacker whether the code was wrong or merely stale. */
export class InvalidOtpError extends Error {
  constructor() {
    super('That code is invalid or has expired. Please request a new one.')
    this.name = 'InvalidOtpError'
  }
}

/**
 * The OTP was minted but WhatsApp would not carry it.
 *
 * Deliberately a SUBCLASS of ProviderConfigurationError, which every OTP route
 * already catches and maps to a 503 "temporarily unavailable". From the
 * shopper's side the two are the same event — no code is coming, try again —
 * and the alternative was six routes each growing a second, identical catch
 * that a seventh route would forget. `handle()` would otherwise turn a Meta
 * outage into a 500, which reads as our bug and gets a retry from nobody.
 */
export class OtpDeliveryError extends ProviderConfigurationError {
  constructor(detail: string) {
    super('WhatsApp')
    this.name = 'OtpDeliveryError'
    this.message = `Could not deliver the WhatsApp OTP: ${detail}`
  }
}

/** Bad email shape. Route maps to 400. */
export class InvalidEmailError extends Error {
  constructor() {
    super('Enter a valid email address.')
    this.name = 'InvalidEmailError'
  }
}

/** Wrong / expired / already-used magic link. Route redirects to /login?error=link. */
export class InvalidMagicLinkError extends Error {
  constructor() {
    super('This sign-in link is invalid or has expired.')
    this.name = 'InvalidMagicLinkError'
  }
}

/** Google returned an unverified email. Route redirects to /login?error=google.
 *  We only trust a Google identity whose email Google itself has verified. */
export class UnverifiedGoogleEmailError extends Error {
  constructor() {
    super('Your Google email is not verified, so we could not sign you in.')
    this.name = 'UnverifiedGoogleEmailError'
  }
}

/** Reduce any user-entered phone to the bare national number: strip non-digits,
 *  then take the last 10 so a leading +91 / 0 doesn't fail validation. Exported
 *  so routes can key per-phone rate limits on the same canonical value. */
export function normalizePhone(input: string): string {
  const digits = (input || '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

/** Lowercased + trimmed. Exported so routes can key per-address rate limits on
 *  the same canonical value this service stores and looks rows up by. */
export function normalizeEmail(input: string): string {
  return (input || '').trim().toLowerCase()
}

// Deliberately conservative single-line check — real validation is the delivered
// link/code round-trip, this only rejects obvious garbage before we hit the DB.
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export interface RequestOtpResult {
  mock: boolean
  /** Present ONLY in mock mode so the code is testable without a live provider. */
  devCode?: string
}

/**
 * Start a phone-OTP challenge: mint a 6-digit code, store its hash, and send it
 * (or mock). Any prior challenge for this phone is deleted first, so there is at
 * most one live code per number and a re-request always supersedes the old one.
 *
 * The stored hash is over `otp:<phone>:<code>`, not the bare code. Two different
 * numbers can independently draw the same 6-digit code, and VerificationToken.token
 * is globally @unique — folding the identifier into the hash keeps those rows
 * distinct so the second create can't collide.
 *
 * ── Delivery is WhatsApp, not SMS ──────────────────────────────────────────
 * The code goes out on one of two approved templates and NOTHING falls back to
 * MSG91: a shopper who does not get the WhatsApp message must retry, not
 * silently receive a second code down a channel nobody is watching. `sendSms`
 * stays in otp.ts for the reward-code path (`sendTextSms`), which still needs a
 * DLT template. Anything gating phone sign-in on `smsConfigured()` is now
 * asking the wrong question — ask `whatsappConfigured(brand)`.
 *
 * WHICH template is decided here, by whether this number already has an account:
 * `signup_otp` welcomes her to the family, `login_otp` says welcome back. Sending
 * the wrong one is not a cosmetic slip — greeting a two-year customer as a new
 * registration is the kind of thing she notices and we do not.
 */
export async function requestOtp(brand: Brand, phone: string): Promise<RequestOtpResult> {
  const prisma = dbFor(brand)
  const normalized = normalizePhone(phone)
  if (normalized.length !== 10) throw new InvalidPhoneError()

  const identifier = `otp:${normalized}`
  const code = generateCode()
  const token = hashCode(`${identifier}:${code}`)

  // Single active challenge per phone.
  await prisma.verificationToken.deleteMany({ where: { identifier } })
  await prisma.verificationToken.create({
    data: { identifier, token, expires: new Date(Date.now() + OTP_TTL_MS) },
  })

  // A returning shopper is greeted by name; a new number has none to greet with,
  // and an empty template parameter is rejected by Meta outright.
  const existing = await prisma.user.findUnique({
    where: { phone: normalized },
    select: { name: true },
  })
  const template = existing ? WHATSAPP_TEMPLATES.loginOtp : WHATSAPP_TEMPLATES.signupOtp
  const customerName = existing?.name?.trim().split(' ')[0] || 'there'

  try {
    const { mock } = await sendWhatsappTemplateOrThrow(brand, {
      to: normalized,
      template,
      params: [customerName, code],
    })
    return { mock, ...(mock ? { devCode: code } : {}) }
  } catch (err) {
    // A missing token already IS a ProviderConfigurationError; only a real send
    // failure needs wrapping, so the route sees one type either way.
    if (err instanceof ProviderConfigurationError) throw err

    // LOG BEFORE THROWING, because nothing downstream will. Every OTP route
    // catches ProviderConfigurationError — which OtpDeliveryError extends, on
    // purpose — and answers a flat 503 "temporarily unavailable" without
    // touching the message. So Meta's actual complaint (132001 wrong template
    // or language, 132000 wrong parameter count, an expired token) reached the
    // shopper as four words and reached the operator as nothing at all: no log
    // line, no Sentry event, an empty CloudWatch group and a sign-in that
    // simply does not work. Diagnosing it meant reasoning backwards from a
    // health check. The detail belongs here, once, where it is still intact.
    const detail = String(err).slice(0, 300)
    logger.error('otp_whatsapp_delivery_failed', { brand, template, detail })
    throw new OtpDeliveryError(detail)
  }
}

/**
 * Verify a phone-OTP challenge. On success: upsert the User by phone (keeping any
 * existing name so a returning shopper isn't blanked), consume the challenge, and
 * return the User for the route to mint a session from. The phone key means a
 * shopper who checked out as a guest with this number owns those orders.
 * Throws InvalidOtpError on a wrong / expired / missing code.
 */
export interface TharaAttributionCtx {
  cookieToken: string | null
  ip: string | null
  ua: string | null
}

/**
 * Optionally attach a Thara referral to a newly-signed-in user. Fire-and-forget
 * by design — attribution failure must never block sign-in. Dynamic import
 * breaks any potential circular boot-time dependency.
 */
function maybeAttribute(brand: Brand, user: User, ctx: TharaAttributionCtx | undefined) {
  if (!ctx) return
  void import('./thara')
    .then(({ attributeReferralIfPresent }) => attributeReferralIfPresent(brand, user, ctx))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('attribute referral failed', err)
    })
}

/**
 * Check a live phone OTP challenge and CONSUME it on success. Shared by the
 * sign-in path (verifyOtp, which then upserts a User) and the attach-a-number
 * path (verifyPhoneChallenge, which must not create a second account) so both
 * get the identical guess budget, expiry rule and replay protection.
 * Returns the normalised phone; throws InvalidPhoneError / InvalidOtpError.
 */
async function consumePhoneChallenge(brand: Brand, phone: string, code: string): Promise<string> {
  const prisma = dbFor(brand)
  const normalized = normalizePhone(phone)
  if (normalized.length !== 10) throw new InvalidPhoneError()

  const cleanCode = (code || '').replace(/\D/g, '')
  if (cleanCode.length !== 6) throw new InvalidOtpError()

  const identifier = `otp:${normalized}`
  const token = hashCode(`${identifier}:${cleanCode}`)

  // Match identifier + hash + not-expired in one query. A wrong code yields no
  // row; an expired one is filtered out — both surface as the same vague error.
  const challenge = await prisma.verificationToken.findFirst({
    where: { identifier, token, expires: { gt: new Date() } },
  })
  if (!challenge) {
    // Cap guesses per code lifetime. The single live code is otherwise
    // brute-forceable for the full TTL (a wrong code doesn't consume it). Count
    // failed attempts per phone; once the cap is hit, burn the challenge so the
    // attacker must request a fresh code instead of continuing to guess. A
    // correct code always finds its (still-live) challenge above and skips this.
    const fail = await rateLimit(`otp:fail:${normalized}`, 5, 5 * 60 * 1000)
    if (!fail.ok) {
      await prisma.verificationToken.deleteMany({ where: { identifier } })
    }
    throw new InvalidOtpError()
  }

  // Consume every challenge for this identifier so a code can't be replayed.
  await prisma.verificationToken.deleteMany({ where: { identifier } })
  return normalized
}

export async function verifyOtp(brand: Brand, 
  phone: string,
  code: string,
  attributionCtx?: TharaAttributionCtx,
): Promise<User> {
  const prisma = dbFor(brand)
  const normalized = await consumePhoneChallenge(brand, phone, code)

  // Passing the challenge IS the verification, so stamp phoneVerified on both
  // branches — a returning shopper whose row predates this column gets it
  // backfilled on their next sign-in. Nothing else on the row is touched, so an
  // existing name / email / avatar survives.
  const user = await prisma.user.upsert({
    where: { phone: normalized },
    update: { phoneVerified: new Date() },
    create: { phone: normalized, phoneVerified: new Date(), role: 'customer' },
  })

  maybeAttribute(brand, user, attributionCtx)
  return user
}

/**
 * Verify an OTP for a signed-in customer who is ATTACHING this number to their
 * existing account. Deliberately does not upsert a User: the caller already has
 * an identity and creating a second row keyed on the phone is exactly the split
 * that orphans an email-signup shopper's orders. Returns the normalised phone
 * for the caller to hand to attachIdentity().
 */
export async function verifyPhoneChallenge(brand: Brand, phone: string, code: string): Promise<string> {
  return consumePhoneChallenge(brand, phone, code)
}

export interface RequestMagicLinkResult {
  mock: boolean
  /** Present ONLY in mock mode so the link is usable without a live email provider. */
  devLink?: string
}

/**
 * Start an email magic-link challenge: mint a random token, store its hash, build
 * the verify URL with the RAW token, and send it (or mock). Prior challenges for
 * this email are cleared first so only the newest link works.
 *
 * `next` is the post-sign-in destination. It rides on the LINK rather than in the
 * DB row because the tab that opens the mail is often not the tab that requested
 * it, so there is no client state left to restore it from. The caller is
 * responsible for having passed it through safeNextPath first; the verify route
 * re-validates on the way back in, since the link is user-visible and editable.
 */
export async function requestMagicLink(brand: Brand, email: string, next?: string): Promise<RequestMagicLinkResult> {
  const prisma = dbFor(brand)
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized)) throw new InvalidEmailError()

  const identifier = `email:${normalized}`
  const raw = generateToken()
  const token = hashCode(raw)

  await prisma.verificationToken.deleteMany({ where: { identifier } })
  await prisma.verificationToken.create({
    data: { identifier, token, expires: new Date(Date.now() + LINK_TTL_MS) },
  })

  // The link carries the RAW token; the DB only ever holds its hash. NEXT_PUBLIC_SITE_URL
  // is the canonical origin so the link resolves the same whatever host issued it.
  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const nextParam = next && next !== '/account' ? `&next=${encodeURIComponent(next)}` : ''
  const link = `${base}/api/auth/email/verify?token=${encodeURIComponent(raw)}&email=${encodeURIComponent(normalized)}${nextParam}`

  const { mock } = await sendMagicLink(brand, normalized, link)
  return { mock, ...(mock ? { devLink: link } : {}) }
}

/**
 * Verify an email magic-link challenge. On success: upsert the User by email
 * (stamping emailVerified), consume the challenge, and return the User for the
 * route to mint a session. Throws InvalidMagicLinkError on any bad/expired token.
 */
export async function verifyMagicLink(brand: Brand, 
  email: string,
  token: string,
  attributionCtx?: TharaAttributionCtx,
): Promise<User> {
  const prisma = dbFor(brand)
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized) || !token) throw new InvalidMagicLinkError()

  const identifier = `email:${normalized}`
  const hash = hashCode(token)

  const challenge = await prisma.verificationToken.findFirst({
    where: { identifier, token: hash, expires: { gt: new Date() } },
  })
  if (!challenge) throw new InvalidMagicLinkError()

  const user = await prisma.user.upsert({
    where: { email: normalized },
    update: { emailVerified: new Date() },
    create: { email: normalized, emailVerified: new Date(), role: 'customer' },
  })

  await prisma.verificationToken.deleteMany({ where: { identifier } })
  maybeAttribute(brand, user, attributionCtx)
  return user
}

/**
 * Sign in (or register) a customer from a verified Google profile. Like the
 * magic-link path this keys on the @unique email, so a shopper who previously
 * used the email link — or checked out with this address — lands on the SAME
 * account. We only accept a Google-verified email (no challenge round-trip here,
 * so the verification IS the trust anchor), stamp emailVerified, keep an existing
 * name, and backfill the avatar only when we don't already have one.
 * Throws UnverifiedGoogleEmailError if Google says the email isn't verified.
 */
export async function signInWithGoogle(brand: Brand, 
  profile: GoogleProfile,
  attributionCtx?: TharaAttributionCtx,
): Promise<User> {
  const prisma = dbFor(brand)
  const normalized = normalizeEmail(profile.email)
  if (!isValidEmail(normalized) || !profile.emailVerified) throw new UnverifiedGoogleEmailError()

  const name = profile.name?.trim() || undefined
  const image = profile.picture?.trim() || undefined

  const existing = await prisma.user.findUnique({ where: { email: normalized } })
  const user = await prisma.user.upsert({
    where: { email: normalized },
    // Don't blank an existing name/avatar; only fill gaps.
    update: {
      emailVerified: new Date(),
      ...(existing?.name ? {} : name ? { name } : {}),
      ...(existing?.image ? {} : image ? { image } : {}),
    },
    create: {
      email: normalized,
      emailVerified: new Date(),
      role: 'customer',
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
    },
  })
  maybeAttribute(brand, user, attributionCtx)
  return user
}

// ─────────────────── Attaching a second contact channel ────────────────────
/**
 * Both User.email and User.phone are @unique, and every signup path fills in
 * exactly ONE of them. Adding the other later therefore always risks colliding
 * with a row that already owns the value — the hazard the audit found in
 * checkout's blind upsert, which either tripped P2002 into a 500 or silently
 * dropped the value depending on how Prisma emits `not: <string>` against NULL.
 *
 * Every write to User.email / User.phone outside verifyOtp's own create goes
 * through attachIdentity below, and the decision is settled: we REFUSE with a
 * 409 and never merge implicitly. A real merge has to re-point Order, Address,
 * Cart, PointsLedger, Subscription, Thara* and Review at a surviving row, and
 * TharaMembership.userId / TharaReferral.referredUserId being @unique make that
 * genuinely hard — it is not something to attempt inside a payment flow.
 */

export type IdentityField = 'email' | 'phone'

export class IdentityConflictError extends Error {
  constructor(public field: IdentityField) {
    super(
      field === 'email'
        ? 'That email is already on another Femi9 account. Sign in with it instead.'
        : 'That mobile number is already on another Femi9 account. Sign in with it instead.',
    )
    this.name = 'IdentityConflictError'
  }
}

/** PrismaClient is assignable to TransactionClient, so callers pass either the
 *  open `tx` or the bare `prisma` — same convention as services/affiliate.ts. */
type DbClient = Prisma.TransactionClient

/** Who currently owns `value` on `field`, or null when it is free. */
async function identityOwnerId(
  db: DbClient,
  field: IdentityField,
  value: string,
): Promise<string | null> {
  const row = await db.user.findUnique({
    where: field === 'email' ? { email: value } : { phone: value },
    select: { id: true },
  })
  return row?.id ?? null
}

/**
 * Throw IdentityConflictError when `value` already belongs to a DIFFERENT user.
 * Call this BEFORE an irreversible side effect — notably before spending an SMS
 * on an OTP for a number we are going to refuse anyway.
 */
export async function assertIdentityFree(brand: Brand, 
  userId: string,
  field: IdentityField,
  value: string,
): Promise<void> {
  const prisma = dbFor(brand)
  const normalized = field === 'email' ? normalizeEmail(value) : normalizePhone(value)
  const owner = await identityOwnerId(prisma, field, normalized)
  if (owner && owner !== userId) throw new IdentityConflictError(field)
}

/**
 * Attach a second contact channel to an EXISTING user row.
 *  - value free            → UPDATE this row (P2002 retried once for the race)
 *  - value owned by self   → written anyway (same value; the verified stamp is
 *                            the point of a re-verify, and it cannot collide)
 *  - value owned by OTHER  → throw IdentityConflictError, caller returns 409
 *
 * `db` is the caller's transaction client when one is open, else `prisma`, so a
 * checkout can attach inside the same transaction that creates the order.
 */
export async function attachIdentity(
  db: DbClient,
  userId: string,
  patch: { email?: string; emailVerified?: Date | null; phone?: string; phoneVerified?: Date | null },
): Promise<void> {
  const email = patch.email === undefined ? undefined : normalizeEmail(patch.email)
  const phone = patch.phone === undefined ? undefined : normalizePhone(patch.phone)

  if (email !== undefined && !isValidEmail(email)) throw new InvalidEmailError()
  if (phone !== undefined && phone.length !== 10) throw new InvalidPhoneError()

  // Check ownership first so the common conflict is a clean 409 rather than a
  // caught constraint violation. The P2002 catch below is only for the race.
  if (email !== undefined) {
    const owner = await identityOwnerId(db, 'email', email)
    if (owner && owner !== userId) throw new IdentityConflictError('email')
  }
  if (phone !== undefined) {
    const owner = await identityOwnerId(db, 'phone', phone)
    if (owner && owner !== userId) throw new IdentityConflictError('phone')
  }

  const data: Prisma.UserUpdateInput = {
    ...(email !== undefined ? { email } : {}),
    ...(patch.emailVerified !== undefined ? { emailVerified: patch.emailVerified } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(patch.phoneVerified !== undefined ? { phoneVerified: patch.phoneVerified } : {}),
  }
  if (Object.keys(data).length === 0) return

  try {
    await db.user.update({ where: { id: userId }, data })
  } catch (err) {
    // Someone claimed the value between our SELECT and this UPDATE. Re-read the
    // owner: if it is now a different row the answer really is 409, and if the
    // row vanished (a concurrent delete) the retry surfaces the real error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // meta.target names the violated index ('email' / 'phone'); fall back to
      // whichever column this call was actually writing when it is absent.
      const meta = err.meta as { target?: unknown } | undefined
      const target = Array.isArray(meta?.target) ? (meta.target as string[]) : []
      const field: IdentityField =
        target.includes('phone') || (target.length === 0 && phone !== undefined) ? 'phone' : 'email'
      const value = field === 'phone' ? phone : email
      if (value !== undefined) {
        const owner = await identityOwnerId(db, field, value)
        if (owner && owner !== userId) throw new IdentityConflictError(field)
      }
      try {
        await db.user.update({ where: { id: userId }, data })
      } catch (retryErr) {
        // Still colliding after a fresh look at the owner. We cannot explain the
        // state, but "that value is taken" is a truthful 409 and a 500 is not.
        if (retryErr instanceof Prisma.PrismaClientKnownRequestError && retryErr.code === 'P2002') {
          throw new IdentityConflictError(field)
        }
        throw retryErr
      }
      return
    }
    throw err
  }
}

/**
 * Start an email-confirmation challenge for a SIGNED-IN user attaching or
 * verifying an address. Reuses the magic-link machinery but under its own
 * `attach-email:<userId>:<email>` identifier namespace, so a token minted here
 * can never be redeemed by the sign-in verifier to mint a session for a
 * different account.
 */
export async function requestAttachEmailLink(brand: Brand, 
  userId: string,
  email: string,
): Promise<RequestMagicLinkResult> {
  const prisma = dbFor(brand)
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized)) throw new InvalidEmailError()

  const identifier = `attach-email:${userId}:${normalized}`
  const raw = generateToken()
  const token = hashCode(raw)

  await prisma.verificationToken.deleteMany({ where: { identifier } })
  await prisma.verificationToken.create({
    data: { identifier, token, expires: new Date(Date.now() + LINK_TTL_MS) },
  })

  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  const link = `${base}/api/account/email/verify?token=${encodeURIComponent(raw)}&email=${encodeURIComponent(normalized)}`

  const { mock } = await sendMagicLink(brand, normalized, link)
  return { mock, ...(mock ? { devLink: link } : {}) }
}

/**
 * Redeem an attach-email token for `userId`. Returns the normalised address on
 * success (the caller then runs attachIdentity to stamp emailVerified); throws
 * InvalidMagicLinkError for a wrong / expired / already-used token, or one
 * minted for a different user.
 */
export async function verifyAttachEmailToken(brand: Brand, 
  userId: string,
  email: string,
  token: string,
): Promise<string> {
  const prisma = dbFor(brand)
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized) || !token) throw new InvalidMagicLinkError()

  const identifier = `attach-email:${userId}:${normalized}`
  const hash = hashCode(token)

  const challenge = await prisma.verificationToken.findFirst({
    where: { identifier, token: hash, expires: { gt: new Date() } },
  })
  if (!challenge) throw new InvalidMagicLinkError()

  await prisma.verificationToken.deleteMany({ where: { identifier } })
  return normalized
}

/**
 * Fire-and-forget dispatch of the confirm-your-email link. Used where the
 * address is written unverified (/welcome, PATCH /api/account/profile): the
 * write must not fail because Resend is down, and the customer can always
 * re-request from /account.
 */
export function dispatchEmailVerification(brand: Brand, userId: string, email: string): void {
  void requestAttachEmailLink(brand, userId, email).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[auth] email verification dispatch failed', err)
  })
}

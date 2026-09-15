'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MemberSignOutButton } from '@/components/MemberLayout'
import { IAlert, IBell, IBox, ICheck, IChevron, IInfo, IUser } from '@/components/AppIcons'
import { OptImg } from '@/components/OptImg'
import { useMediaGate } from '@/components/useMediaGate'
import type { ProfileField } from '@femi9/core/services/account'

/**
 * The onboarding form behind /welcome.
 *
 * Two paths, one component, zero per-provider branches — `missing` from the
 * server decides which fields render:
 *
 *   • phone OTP signup  → missing = [name, email]  → one screen, then done
 *   • magic link/Google → missing = [name?, phone] → step A saves the name and
 *     starts an OTP challenge, step B verifies it
 *
 * A phone is NEVER written from step A. An unverified number on the User row is
 * worse than none, because checkout attribution and the Thara self-referral
 * guard both treat phone as an identity — so step A only starts the challenge
 * and `POST /api/account/phone/verify` is what actually attaches it.
 *
 * Abandonment is resumable by construction: every field is persisted the moment
 * it is submitted, so returning here re-renders only what is still outstanding.
 * The one thing the server cannot remember is the number typed into a challenge
 * that was never answered, so that lives in sessionStorage.
 */

type Step = 'details' | 'code'
type FieldKey = ProfileField | 'code'
type StepState = 'done' | 'current' | 'todo'

/** Where the unanswered phone challenge is remembered across a closed tab. */
const HINT_KEY = 'femi9:welcome:phone'
/** The OTP lives 5 minutes server-side - deliberately shorter than the ten the
 *  WhatsApp template promises; see OTP_TTL_MS in packages/core/src/services/auth.ts.
 *  Resume onto an existing challenge only while there is comfortably enough of it
 *  left to open WhatsApp and type six digits; past that, ask for a fresh one
 *  instead of guaranteeing a failure. Keep this BELOW OTP_TTL_MS - the two have
 *  no way to check each other. */
const HINT_RESUME_MS = 4 * 60 * 1000
const RESEND_COOLDOWN_S = 30
const FIELD_ORDER: FieldKey[] = ['name', 'email', 'phone', 'code']

/** Why each field is being asked for. Stated in the brand panel, because a form
 *  that explains itself gets finished and one that does not gets abandoned. */
const REASONS: Record<ProfileField, { Icon: typeof IUser; title: string; body: string }> = {
  name: {
    Icon: IUser,
    title: 'Your name',
    body: 'So your deliveries and order updates are addressed to you, not to a phone number.',
  },
  email: {
    Icon: IBox,
    title: 'Your email',
    body: 'Order confirmations and your Bloom reward codes arrive here.',
  },
  phone: {
    Icon: IBell,
    title: 'Your mobile',
    body: 'Delivery updates on WhatsApp, and a one-tap sign-in the next time you visit.',
  },
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export interface WelcomeFlowProps {
  /** Ordered [name, email, phone] — whatever the User row is still missing. */
  initialMissing: ProfileField[]
  /** Already validated by the server page; null means "land on /dashboard". */
  next: string | null
}

export function WelcomeFlow({ initialMissing, next }: WelcomeFlowProps) {
  const router = useRouter()

  const [missing, setMissing] = useState<ProfileField[]>(initialMissing)
  const [step, setStep] = useState<Step>('details')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')

  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [conflictField, setConflictField] = useState<ProfileField | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)   // 429 lockout, seconds
  const [resendIn, setResendIn] = useState(0)   // resend gate, seconds
  const [leaving, setLeaving] = useState(false)
  const [focusTarget, setFocusTarget] = useState<FieldKey | null>(null)

  /** Matches auth.css's 900px stack, where the brand artwork stops painting. */
  const showAsideArt = useMediaGate('(min-width: 901px)')

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const needsName = missing.includes('name')
  const needsEmail = missing.includes('email')
  const needsPhone = missing.includes('phone')
  const startedNeedingPhone = initialMissing.includes('phone')

  // ── Resume an abandoned phone challenge ────────────────────────────────────
  useEffect(() => {
    if (!startedNeedingPhone) return
    try {
      const raw = window.sessionStorage.getItem(HINT_KEY)
      if (!raw) return
      const hint = JSON.parse(raw) as { phone?: unknown; sentAt?: unknown }
      if (typeof hint.phone !== 'string' || hint.phone.length !== 10) return
      setPhone(hint.phone)
      if (typeof hint.sentAt === 'number' && Date.now() - hint.sentAt < HINT_RESUME_MS) setStep('code')
    } catch {
      // A corrupt or blocked sessionStorage just means we start at step A with
      // the number re-entered by hand. Never a reason to fail the screen.
    }
  }, [startedNeedingPhone])

  // ── Countdowns. setTimeout re-armed by its own dependency, so there is no
  //    interval to leak and no state updater with a side effect inside it. ────
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => {
      setCooldown(cooldown - 1)
      // Once the window has elapsed the banner is stale, so it goes with it.
      if (cooldown - 1 === 0) setBanner(null)
    }, 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setTimeout(() => setResendIn(resendIn - 1), 1000)
    return () => window.clearTimeout(id)
  }, [resendIn])

  // ── Focus, deferred one render so the target is mounted. A failed submit that
  //    also changes step (a 409 on the code screen) would otherwise focus a
  //    field that does not exist yet. ─────────────────────────────────────────
  useEffect(() => {
    if (!focusTarget) return
    const el =
      focusTarget === 'name'
        ? nameRef.current
        : focusTarget === 'email'
          ? emailRef.current
          : focusTarget === 'phone'
            ? phoneRef.current
            : codeRef.current
    el?.focus()
    setFocusTarget(null)
  }, [focusTarget, step])

  const rememberPhone = useCallback((value: string) => {
    try {
      window.sessionStorage.setItem(HINT_KEY, JSON.stringify({ phone: value, sentAt: Date.now() }))
    } catch {
      /* Private-mode storage refusal is not worth surfacing. */
    }
  }, [])

  const forgetPhone = useCallback(() => {
    try {
      window.sessionStorage.removeItem(HINT_KEY)
    } catch {
      /* see rememberPhone */
    }
  }, [])

  /** Profile complete: leave for wherever the shopper was originally headed. */
  const finish = useCallback(() => {
    setLeaving(true)
    forgetPhone()
    router.replace(next ?? '/dashboard')
    router.refresh()
  }, [forgetPhone, next, router])

  const focusFirst = useCallback((errs: Partial<Record<FieldKey, string>>) => {
    const first = FIELD_ORDER.find((key) => errs[key])
    if (first) setFocusTarget(first)
  }, [])

  /**
   * The single place a non-OK response becomes UI. Field-level problems land on
   * the offending input; only a whole-request failure reaches the banner.
   */
  const handleFailure = useCallback(
    (status: number, data: Record<string, unknown>, currentStep: Step) => {
      const message = str(data.error) ?? 'Something went wrong. Please try again.'

      if (status === 401) {
        // The session expired mid-onboarding. Nothing entered is lost — every
        // field was persisted as it was submitted.
        router.replace('/login')
        return
      }

      if (status === 429) {
        const wait = typeof data.retryAfterSec === 'number' ? Math.max(1, Math.ceil(data.retryAfterSec)) : 60
        setCooldown(wait)
        setBanner('Too many attempts. You can try again in')
        return
      }

      if (status === 409) {
        const field = data.field === 'email' || data.field === 'phone' ? (data.field as ProfileField) : null
        if (field) {
          setErrors((prev) => {
            const merged: Partial<Record<FieldKey, string>> = { ...prev }
            merged[field] = message
            return merged
          })
          setConflictField(field)
          setFocusTarget(field)
          return
        }
        setBanner(message)
        return
      }

      if (status === 400) {
        const details = data.details as { fieldErrors?: Record<string, unknown> } | undefined
        const fieldErrors = details?.fieldErrors
        if (fieldErrors && typeof fieldErrors === 'object') {
          const mapped: Partial<Record<FieldKey, string>> = {}
          for (const key of ['name', 'email', 'phone'] as const) {
            const list = (fieldErrors as Record<string, unknown>)[key]
            if (Array.isArray(list) && typeof list[0] === 'string') mapped[key] = list[0]
          }
          if (Object.keys(mapped).length > 0) {
            setErrors(mapped)
            focusFirst(mapped)
            return
          }
        }
        // A 400 with no field map — a wrong code, an unparseable body — belongs
        // on the control the shopper just used, not in a detached banner.
        if (currentStep === 'code') {
          setErrors({ code: message })
          setFocusTarget('code')
          return
        }
        setBanner(message)
        return
      }

      setBanner(message)
    },
    [focusFirst, router],
  )

  // ── Step A: name / email / mobile ──────────────────────────────────────────
  function validateDetails(): Partial<Record<FieldKey, string>> {
    const found: Partial<Record<FieldKey, string>> = {}
    if (needsName) {
      const trimmed = name.trim()
      if (trimmed.length < 2) found.name = 'Enter your full name.'
      else if (trimmed.length > 120) found.name = 'That name is longer than we can store.'
    }
    // Mirrors the server's zod check closely enough to catch typos without
    // rejecting an address the server would have accepted.
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      found.email = 'Enter a valid email address.'
    }
    if (needsPhone && phone.length !== 10) found.phone = 'Enter your 10-digit mobile number.'
    return found
  }

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault()
    if (busy || cooldown > 0) return
    setBanner(null)
    setConflictField(null)

    const found = validateDetails()
    if (Object.keys(found).length > 0) {
      setErrors(found)
      focusFirst(found)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const payload: Record<string, string> = {}
      if (needsName) payload.name = name.trim()
      if (needsEmail) payload.email = email.trim()
      if (needsPhone) payload.phone = phone

      const res = await fetch('/api/account/complete-profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJson(res)
      if (!res.ok) {
        handleFailure(res.status, data, 'details')
        return
      }

      if (Array.isArray(data.missing)) setMissing(data.missing as ProfileField[])

      if (data.phoneVerificationRequired === true) {
        rememberPhone(phone)
        setDevCode(str(data.devCode))
        setCode('')
        setResendIn(RESEND_COOLDOWN_S)
        setStep('code')
        setFocusTarget('code')
        return
      }
      if (data.profileComplete === true) {
        finish()
        return
      }
      // Saved, but the server still wants something. `missing` above has already
      // re-driven the form; say so rather than appearing to do nothing.
      setBanner('We still need a little more before your account is ready.')
    } catch {
      setBanner('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  // ── Step B: verify the mobile number ───────────────────────────────────────
  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy || cooldown > 0) return
    setBanner(null)
    setConflictField(null)

    if (code.length !== 6) {
      setErrors({ code: 'Enter the 6-digit code we sent you.' })
      setFocusTarget('code')
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const res = await fetch('/api/account/phone/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const data = await readJson(res)
      if (!res.ok) {
        // A 409 here means the number was claimed by another account between the
        // challenge and the answer — the code screen is a dead end, so go back
        // and let her enter a different number.
        if (res.status === 409) {
          forgetPhone()
          setCode('')
          setStep('details')
        }
        handleFailure(res.status, data, 'code')
        return
      }

      if (Array.isArray(data.missing)) setMissing(data.missing as ProfileField[])
      if (data.profileComplete === true) {
        finish()
        return
      }
      // Number attached, something else outstanding: back to the field list.
      forgetPhone()
      setCode('')
      setStep('details')
    } catch {
      setBanner('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resendCode() {
    if (busy || cooldown > 0 || resendIn > 0) return
    setBanner(null)
    setErrors({})
    setBusy(true)
    try {
      const res = await fetch('/api/account/phone/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await readJson(res)
      if (!res.ok) {
        handleFailure(res.status, data, 'code')
        return
      }
      setDevCode(str(data.devCode))
      rememberPhone(phone)
      setResendIn(RESEND_COOLDOWN_S)
      setCode('')
      setFocusTarget('code')
    } catch {
      setBanner('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  function changeNumber() {
    forgetPhone()
    setCode('')
    setDevCode(null)
    setErrors({})
    setBanner(null)
    setConflictField(null)
    setStep('details')
    setFocusTarget('phone')
  }

  // ── Progress ───────────────────────────────────────────────────────────────
  const steps: { key: string; label: string; state: StepState }[] = [
    { key: 'signed-in', label: 'Signed in', state: 'done' },
    { key: 'details', label: 'Your details', state: step === 'details' ? 'current' : 'done' },
    ...(needsPhone
      ? [{ key: 'verify', label: 'Verify mobile', state: (step === 'code' ? 'current' : 'todo') as StepState }]
      : []),
  ]

  const blocked = busy || cooldown > 0
  // The reasons panel is seeded from the ORIGINAL gap list so it does not lose
  // rows as the form is completed — it explains why we asked, not what is left.
  const reasons = initialMissing.map((field) => ({ field, ...REASONS[field] }))

  return (
    <>
      {/* The same static lavender field the storefront and member layouts paint,
          so onboarding does not look like a different product. Kept a sibling of
          the content (as MemberLayout does) so its z-index:-1 resolves against
          the root stacking context. */}
      <div className="liquid-bg liquid-bg--fallback" aria-hidden="true" />

      <div className="m-area auth-area">
        <div className="auth-shell">
          {/* ── Brand panel ──────────────────────────────────────────────────── */}
          <aside className="auth-aside">
            <Link href="/" className="auth-aside__brand" aria-label="Femi9 home">
              {/* 5 KB, below the derivative-ladder threshold — plain <img> with
                  reserved space, and not lazy: it is in the first viewport. */}
              <img src="/assets/figma-home/footer-imgImage1.png" alt="Femi9" width={86} height={30} decoding="async" />
            </Link>

            <div>
              <span className="eyebrow">Almost there</span>
              <h2 className="auth-aside__title">A few details and your Femi9 account is ready.</h2>
            </div>
            <p className="auth-aside__copy">
              We ask for these once. Everything you enter is stored against your account and can be changed later.
            </p>

            <ul className="auth-points">
              {reasons.map(({ field, Icon, title, body }) => (
                <li className="auth-point" key={field}>
                  <span className="auth-point__icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="auth-point__text">
                    <b>{title}</b>
                    <span>{body}</span>
                  </span>
                </li>
              ))}
            </ul>

            {/* Gated rather than CSS-hidden — see auth.css §10; display:none
                does not cancel the download. */}
            {showAsideArt && (
              <OptImg className="auth-aside__art" base="figma-home/footer-imgImage9" sizes="230px" alt="" />
            )}
          </aside>

          {/* ── Form panel ───────────────────────────────────────────────────── */}
          <main className="auth-main">
            <ol className="auth-steps" aria-label="Onboarding progress">
              {steps.map((s, index) => (
                <li
                  key={s.key}
                  className={`auth-step${s.state === 'done' ? ' is-done' : ''}${s.state === 'current' ? ' is-current' : ''}`}
                  aria-current={s.state === 'current' ? 'step' : undefined}
                >
                  <span className="auth-step__dot">
                    {s.state === 'done' ? <ICheck aria-hidden="true" /> : index + 1}
                  </span>
                  <span className="auth-step__label">{s.label}</span>
                </li>
              ))}
            </ol>

            <div className="auth-head">
              <h1 className="m-h2">{step === 'code' ? 'Verify your mobile number' : 'Complete your profile'}</h1>
              <p className="auth-sub">
                {step === 'code'
                  ? 'One code and your account is ready. We use this number for delivery updates only.'
                  : 'This takes about twenty seconds, and your account area opens as soon as it is saved.'}
              </p>
            </div>

            {banner && (
              <p className="m-note m-note--danger" role="alert">
                <IAlert aria-hidden="true" />
                <span>
                  {banner}
                  {cooldown > 0 && (
                    <>
                      {' '}
                      <span className="auth-count">{cooldown}s</span>.
                    </>
                  )}
                </span>
              </p>
            )}

            {leaving ? (
              <p className="m-note" role="status">
                <IInfo aria-hidden="true" />
                <span>All set - taking you to your account.</span>
              </p>
            ) : step === 'details' ? (
              <form className="m-form" onSubmit={submitDetails} noValidate>
                {needsName && (
                  <div className="m-field">
                    <label className="m-field__label" htmlFor="welcome-name">
                      Full name
                    </label>
                    <input
                      id="welcome-name"
                      ref={nameRef}
                      className="m-input"
                      type="text"
                      autoComplete="name"
                      autoFocus
                      maxLength={120}
                      placeholder="Priya Nair"
                      aria-invalid={errors.name ? true : undefined}
                      aria-describedby={errors.name ? 'welcome-name-err' : undefined}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value)
                        setErrors((prev) => ({ ...prev, name: undefined }))
                      }}
                    />
                    {errors.name && (
                      <p className="m-field__error" id="welcome-name-err">
                        <IAlert aria-hidden="true" />
                        {errors.name}
                      </p>
                    )}
                  </div>
                )}

                {needsEmail && (
                  <div className="m-field">
                    <label className="m-field__label" htmlFor="welcome-email">
                      Email address
                    </label>
                    <input
                      id="welcome-email"
                      ref={emailRef}
                      className="m-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus={!needsName}
                      placeholder="you@example.com"
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={errors.email ? 'welcome-email-err' : 'welcome-email-hint'}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setErrors((prev) => ({ ...prev, email: undefined }))
                        setConflictField((f) => (f === 'email' ? null : f))
                      }}
                    />
                    {errors.email ? (
                      <p className="m-field__error" id="welcome-email-err">
                        <IAlert aria-hidden="true" />
                        <span>
                          {errors.email}
                          {conflictField === 'email' && (
                            <>
                              {' '}
                              <Link href="/login">Sign in with that email instead</Link>.
                            </>
                          )}
                        </span>
                      </p>
                    ) : (
                      <p className="m-field__hint" id="welcome-email-hint">
                        We send a confirmation link here so you can verify it whenever you like.
                      </p>
                    )}
                  </div>
                )}

                {needsPhone && (
                  <div className="m-field">
                    <label className="m-field__label" htmlFor="welcome-phone">
                      Mobile number
                    </label>
                    <div className="auth-phone">
                      <span className="auth-prefix" aria-hidden="true">
                        +91
                      </span>
                      <input
                        id="welcome-phone"
                        ref={phoneRef}
                        className="m-input"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        autoFocus={!needsName && !needsEmail}
                        maxLength={10}
                        placeholder="10-digit number"
                        aria-invalid={errors.phone ? true : undefined}
                        aria-describedby={errors.phone ? 'welcome-phone-err' : 'welcome-phone-hint'}
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                          setErrors((prev) => ({ ...prev, phone: undefined }))
                          setConflictField((f) => (f === 'phone' ? null : f))
                        }}
                      />
                    </div>
                    {errors.phone ? (
                      <p className="m-field__error" id="welcome-phone-err">
                        <IAlert aria-hidden="true" />
                        <span>
                          {errors.phone}
                          {conflictField === 'phone' && (
                            <>
                              {' '}
                              <Link href="/login">Sign in with that number instead</Link>.
                            </>
                          )}
                        </span>
                      </p>
                    ) : (
                      <p className="m-field__hint" id="welcome-phone-hint">
                        Indian mobile numbers only (+91). We will text a 6-digit code to confirm it is yours.
                      </p>
                    )}
                  </div>
                )}

                <div className="m-form__actions">
                  <button className="btn btn-primary btn--block auth-submit" type="submit" disabled={blocked}>
                    {busy ? 'Saving…' : needsPhone ? 'Save and send code' : 'Save and continue'}
                  </button>
                </div>
              </form>
            ) : (
              <form className="m-form" onSubmit={submitCode} noValidate>
                <p className="auth-sentto">
                  We sent a 6-digit code on WhatsApp to <b>+91 {phone}</b>. It expires in 5 minutes.
                </p>

                {devCode && (
                  <p className="m-note m-note--warning auth-dev">
                    <IInfo aria-hidden="true" />
                    <span>
                      Dev mode - your code is <code>{devCode}</code>
                    </span>
                  </p>
                )}

                <div className="m-field">
                  <label className="m-field__label" htmlFor="welcome-code">
                    Verification code
                  </label>
                  <input
                    id="welcome-code"
                    ref={codeRef}
                    className="m-input auth-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    aria-invalid={errors.code ? true : undefined}
                    aria-describedby={errors.code ? 'welcome-code-err' : undefined}
                    value={code}
                    // One field rather than six boxes: pasting the whole code, SMS
                    // autofill and screen readers all keep working, and the strip
                    // tolerates a paste of "Your Femi9 code is 123456".
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                      setErrors((prev) => ({ ...prev, code: undefined }))
                    }}
                  />
                  {errors.code && (
                    <p className="m-field__error" id="welcome-code-err">
                      <IAlert aria-hidden="true" />
                      {errors.code}
                    </p>
                  )}
                </div>

                <div className="m-form__actions">
                  <button className="btn btn-primary btn--block auth-submit" type="submit" disabled={blocked}>
                    {busy ? 'Verifying…' : 'Verify and finish'}
                  </button>
                </div>

                <div className="auth-resend">
                  <button type="button" className="m-linkbtn" onClick={changeNumber} disabled={busy}>
                    Change number
                  </button>
                  <button type="button" className="m-linkbtn" onClick={resendCode} disabled={blocked || resendIn > 0}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            <div className="auth-foot">
              <p className="auth-legal">
                Nothing is lost if you leave - every detail is saved as you enter it, and this screen picks up where you
                stopped.
              </p>
              <div className="auth-foot__end">
                <Link href="/shop" className="m-linkbtn">
                  Keep shopping
                  <IChevron aria-hidden="true" />
                </Link>
                <MemberSignOutButton />
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  )
}

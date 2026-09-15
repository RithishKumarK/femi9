'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { IAlert, IBox, IChevron, ICycle, IInfo, ISparkles } from '@/components/AppIcons'
import { OptImg } from '@/components/OptImg'
import { useMediaGate } from '@/components/useMediaGate'
import { safeNextPath } from '@/lib/safe-next'

/**
 * Storefront sign-in. Standalone (not under the (store) group) so no nav/footer
 * chrome frames the flow — the screen is one split card instead: the brand panel
 * on the left, the form on the right.
 *
 * Three methods share the one card:
 *   • Phone OTP — number → "Send code" → 6 digits → "Verify"
 *   • Email magic link — address → "Email me a link"
 *   • Google — a top-level navigation to the OAuth start route
 *
 * Where the shopper lands afterwards is NOT unconditionally /account any more:
 *   • middleware sends her here with ?next=<the path she asked for>
 *   • a verify response carrying `needsProfile` routes her through /welcome,
 *     which forwards to the same `next` once her profile is complete.
 *
 * In MOCK/dev mode the request APIs echo a devCode / devLink (no real provider
 * is configured); those are surfaced so the whole flow is usable locally.
 *
 * Presentation is entirely class-driven — the .m-* primitives from member.css
 * plus the .auth-* layout in auth.css. No inline CSSProperties objects.
 */

type Method = 'phone' | 'email'
type PhoneStep = 'enter' | 'code'

/** Where an unqualified sign-in lands. /dashboard, not /account: the dashboard
 *  is the member's front door and carries everything /account does. */
const DEFAULT_NEXT = '/dashboard'
/** Gate on the resend control, comfortably inside the server's 5-per-minute cap. */
const RESEND_COOLDOWN_S = 30

/**
 * The shared open-redirect guard (absolute URLs, `//evil.com`, `/\evil.com` and
 * /api paths are all refused), plus the two loop guards only the sign-in chain
 * needs: forwarding to /login or /welcome from inside them cycles forever.
 *
 * Returns null rather than a fallback so the caller can tell "she asked for
 * nothing in particular" from "she asked for the default".
 */
function resolveNext(raw: string | null | undefined): string | null {
  const safe = safeNextPath(raw, '')
  if (!safe) return null
  if (safe === '/login' || safe.startsWith('/login/') || safe.startsWith('/login?')) return null
  if (safe === '/welcome' || safe.startsWith('/welcome/') || safe.startsWith('/welcome?')) return null
  return safe
}

/** The one place a fetch response is turned into something the UI can branch on. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export default function LoginPage() {
  const router = useRouter()

  const [method, setMethod] = useState<Method>('phone')

  // Phone OTP
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('enter')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)

  // Email magic link
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)   // 429 lockout, seconds
  const [resendIn, setResendIn] = useState(0)   // resend gate, seconds
  const [next, setNext] = useState<string | null>(null)
  // Starts false and only ever flips on a definite `true` from /api/settings, so
  // a deploy without OAuth credentials never renders a prominent button that
  // bounces the shopper straight back here with ?error=google-config.
  const [googleEnabled, setGoogleEnabled] = useState(false)

  /** Matches auth.css's 900px stack, where the brand artwork stops painting. */
  const showAsideArt = useMediaGate('(min-width: 901px)')

  const phoneRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // Read the query string directly rather than via useSearchParams, so the route
  // does not need a Suspense boundary to prerender.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setNext(resolveNext(params.get('next')))

    const reason = params.get('error')
    if (reason === 'link') {
      setError('That sign-in link is invalid or has expired. Request a new one below.')
    } else if (reason === 'google-config') {
      setError('Google sign-in is temporarily unavailable. Use your mobile number or email instead.')
    } else if (reason === 'google') {
      setError('We could not sign you in with Google. Try again, or use another method.')
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && data.googleEnabled === true) setGoogleEnabled(true)
      })
      .catch(() => {
        /* Settings are advisory here; failing to read them just keeps Google hidden. */
      })
    return () => {
      active = false
    }
  }, [])

  // Move focus to the code field the moment the OTP step appears.
  useEffect(() => {
    if (phoneStep === 'code') codeRef.current?.focus()
  }, [phoneStep])

  // A 429 carries `retryAfterSec`; tick it down in place so the shopper sees a
  // real number rather than a dead button. setTimeout re-armed by its own
  // dependency rather than a long-lived interval, so there is nothing to leak
  // and no side effect buried inside a state updater.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => {
      setCooldown(cooldown - 1)
      // Once the window has elapsed the banner is stale, so it goes with it.
      if (cooldown - 1 === 0) setError(null)
    }, 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  // Separate, shorter gate on the resend control: the server allows 5 OTP
  // requests a minute, and a button that can burn them in five taps is a trap.
  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setTimeout(() => setResendIn(resendIn - 1), 1000)
    return () => window.clearTimeout(id)
  }, [resendIn])

  const clearErrors = useCallback(() => {
    setError(null)
    setFieldError(null)
  }, [])

  /** Route a non-OK response into either the field slot or the banner. */
  const reportFailure = useCallback(
    (data: Record<string, unknown>, status: number, fallback: string, field: boolean) => {
      const message = str(data.error) ?? fallback
      if (status === 429) {
        const wait = typeof data.retryAfterSec === 'number' ? Math.max(1, Math.ceil(data.retryAfterSec)) : 60
        setCooldown(wait)
        setError('Too many attempts. You can try again in')
        return
      }
      if (field) setFieldError(message)
      else setError(message)
    },
    [],
  )

  function switchMethod(nextMethod: Method) {
    setMethod(nextMethod)
    clearErrors()
  }

  /** Land the shopper: /welcome when the profile is still missing details,
   *  otherwise the validated `next` (or /account). replace() so Back does not
   *  return to a sign-in form she has already satisfied. */
  function land(needsProfile: boolean) {
    if (needsProfile) {
      const suffix = next ? `?next=${encodeURIComponent(next)}` : ''
      router.replace(`/welcome${suffix}`)
    } else {
      router.replace(next ?? DEFAULT_NEXT)
    }
    router.refresh()
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy || cooldown > 0) return
    clearErrors()
    if (phone.length !== 10) {
      setFieldError('Enter your 10-digit mobile number.')
      phoneRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await readJson(res)
      if (!res.ok) {
        reportFailure(data, res.status, 'Could not send the code. Please try again.', res.status === 400)
        if (res.status === 400) phoneRef.current?.focus()
        return
      }
      setDevCode(str(data.devCode))
      setCode('')
      setResendIn(RESEND_COOLDOWN_S)
      setPhoneStep('code')
    } catch {
      setError('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy || cooldown > 0) return
    clearErrors()
    if (code.length !== 6) {
      setFieldError('Enter the 6-digit code we sent you.')
      codeRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const data = await readJson(res)
      if (!res.ok) {
        reportFailure(data, res.status, 'That code is not valid or has expired.', res.status === 400)
        if (res.status === 400) codeRef.current?.focus()
        return
      }
      // The session cookie is set by the API. `needsProfile` is the server's
      // answer to "did signup capture a name and a second channel yet" — it is
      // absent on older responses, which read as "nothing missing".
      land(data.needsProfile === true)
    } catch {
      setError('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault()
    if (busy || cooldown > 0) return
    clearErrors()
    if (!email.trim()) {
      setFieldError('Enter your email address.')
      emailRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/email/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The mail may well be opened in a different tab (or a different device)
        // from the one that asked for it, so the destination has to travel on the
        // link itself — there is no client state left to restore it from.
        body: JSON.stringify({ email, ...(next ? { next } : {}) }),
      })
      const data = await readJson(res)
      if (!res.ok) {
        reportFailure(data, res.status, 'Could not send the link. Please try again.', res.status === 400)
        if (res.status === 400) emailRef.current?.focus()
        return
      }
      setDevLink(str(data.devLink))
      setEmailSent(true)
    } catch {
      setError('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const blocked = busy || cooldown > 0

  return (
    <>
      {/* The same static lavender field the storefront and member layouts paint,
          so signing in does not look like a different product. Kept a sibling of
          the content (as MemberLayout does) so its z-index:-1 resolves against
          the root stacking context. */}
      <div className="liquid-bg liquid-bg--fallback" aria-hidden="true" />

      <div className="m-area auth-area">
        <div className="auth-shell">
          {/* ── Brand panel ──────────────────────────────────────────────────── */}
          <aside className="auth-aside">
            <Link href="/" className="auth-aside__brand" aria-label="Femi9 home">
              {/* 5 KB, so no derivative ladder exists for it — a plain <img>
                  with reserved space is the right answer. Not lazy: it is the
                  first thing in the first viewport. */}
              <img src="/assets/figma-home/footer-imgImage1.png" alt="Femi9" width={86} height={30} decoding="async" />
            </Link>

            <div>
              <span className="eyebrow">Femi9 members</span>
              <h2 className="auth-aside__title">Your cycle, your orders and your rewards in one place.</h2>
            </div>
            <p className="auth-aside__copy">
              One account across everything Femi9 - no password to remember, just your mobile number or your inbox.
            </p>

            <ul className="auth-points">
              <li className="auth-point">
                <span className="auth-point__icon">
                  <IBox aria-hidden="true" />
                </span>
                <span className="auth-point__text">
                  <b>Track every order</b>
                  <span>See what is on its way and manage your subscription.</span>
                </span>
              </li>
              <li className="auth-point">
                <span className="auth-point__icon">
                  <ICycle aria-hidden="true" />
                </span>
                <span className="auth-point__text">
                  <b>Log your cycle privately</b>
                  <span>Your dates are encrypted before they are stored, and you can delete them any time.</span>
                </span>
              </li>
              <li className="auth-point">
                <span className="auth-point__icon">
                  <ISparkles aria-hidden="true" />
                </span>
                <span className="auth-point__text">
                  <b>Earn Bloom points</b>
                  <span>Collect points on every order and redeem them for rewards.</span>
                </span>
              </li>
            </ul>

            {/* Gated rather than CSS-hidden: auth.css drops the artwork below
                900px, but display:none does not cancel a 1.2 MB download, so
                every phone was paying for a decoration it never sees. */}
            {showAsideArt && (
              <OptImg className="auth-aside__art" base="figma-home/hero-imgImage30" sizes="230px" alt="" />
            )}
          </aside>

          {/* ── Form panel ───────────────────────────────────────────────────── */}
          <main className="auth-main">
            <div className="auth-head">
              <h1 className="m-h2">Sign in or create your account</h1>
              <p className="auth-sub">
                New to Femi9? The same step signs you in and creates your account - there is nothing separate to fill in.
              </p>
            </div>

            {error && (
              <p className="m-note m-note--danger" role="alert">
                <IAlert aria-hidden="true" />
                <span>
                  {error}
                  {cooldown > 0 && (
                    <>
                      {' '}
                      <span className="auth-count">{cooldown}s</span>.
                    </>
                  )}
                </span>
              </p>
            )}

            {googleEnabled && (
              <>
                {/* A top-level navigation to the OAuth start route (not a fetch),
                    so the browser follows Google's redirects. `next` is handed to
                    the start route, which parks it in a cookie for the callback —
                    the round trip through Google keeps no query of ours. */}
                <a
                  href={next ? `/api/auth/google?next=${encodeURIComponent(next)}` : '/api/auth/google'}
                  className="auth-provider"
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  Continue with Google
                </a>
                <p className="auth-or">or</p>
              </>
            )}

            <div className="auth-methods">
              <div className="seg" role="group" aria-label="Sign-in method">
                <button
                  type="button"
                  className={method === 'phone' ? 'on' : undefined}
                  aria-pressed={method === 'phone'}
                  onClick={() => switchMethod('phone')}
                >
                  Mobile number
                </button>
                <button
                  type="button"
                  className={method === 'email' ? 'on' : undefined}
                  aria-pressed={method === 'email'}
                  onClick={() => switchMethod('email')}
                >
                  Email link
                </button>
              </div>
            </div>

            {/* ── Mobile OTP ─────────────────────────────────────────────────── */}
            {method === 'phone' &&
              (phoneStep === 'enter' ? (
                <form className="m-form" onSubmit={sendCode} noValidate>
                  <div className="m-field">
                    <label className="m-field__label" htmlFor="login-phone">
                      Mobile number
                    </label>
                    <div className="auth-phone">
                      <span className="auth-prefix" aria-hidden="true">
                        +91
                      </span>
                      <input
                        id="login-phone"
                        ref={phoneRef}
                        className="m-input"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        autoFocus
                        maxLength={10}
                        placeholder="10-digit number"
                        aria-invalid={fieldError ? true : undefined}
                        aria-describedby={fieldError ? 'login-phone-err' : 'login-phone-hint'}
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                          setFieldError(null)
                        }}
                      />
                    </div>
                    {fieldError ? (
                      <p className="m-field__error" id="login-phone-err">
                        <IAlert aria-hidden="true" />
                        {fieldError}
                      </p>
                    ) : (
                      <p className="m-field__hint" id="login-phone-hint">
                        Indian mobile numbers only (+91). We will send you a 6-digit code on WhatsApp.
                      </p>
                    )}
                  </div>
                  <div className="m-form__actions">
                    <button className="btn btn-primary btn--block auth-submit" type="submit" disabled={blocked}>
                      {busy ? 'Sending…' : 'Send code'}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="m-form" onSubmit={verifyCode} noValidate>
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
                    <label className="m-field__label" htmlFor="login-code">
                      Verification code
                    </label>
                    <input
                      id="login-code"
                      ref={codeRef}
                      className="m-input auth-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      aria-invalid={fieldError ? true : undefined}
                      aria-describedby={fieldError ? 'login-code-err' : undefined}
                      value={code}
                      // A single field (not six boxes) so pasting the whole code,
                      // SMS autofill and screen readers all keep working. The strip
                      // also tolerates a paste of "Your Femi9 code is 123456".
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                        setFieldError(null)
                      }}
                    />
                    {fieldError && (
                      <p className="m-field__error" id="login-code-err">
                        <IAlert aria-hidden="true" />
                        {fieldError}
                      </p>
                    )}
                  </div>

                  <div className="m-form__actions">
                    <button className="btn btn-primary btn--block auth-submit" type="submit" disabled={blocked}>
                      {busy ? 'Verifying…' : 'Verify & continue'}
                    </button>
                  </div>

                  <div className="auth-resend">
                    <button
                      type="button"
                      className="m-linkbtn"
                      onClick={() => {
                        setPhoneStep('enter')
                        setCode('')
                        setDevCode(null)
                        // The per-number send cap does not follow her to a
                        // different number, so the gate resets with the field.
                        setResendIn(0)
                        clearErrors()
                      }}
                    >
                      Change number
                    </button>
                    <button
                      type="button"
                      className="m-linkbtn"
                      onClick={sendCode}
                      disabled={blocked || resendIn > 0}
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                    </button>
                  </div>
                </form>
              ))}

            {/* ── Email magic link ───────────────────────────────────────────── */}
            {method === 'email' &&
              (emailSent ? (
                <div className="m-form">
                  <p className="m-note" role="status">
                    <IInfo aria-hidden="true" />
                    <span>
                      A sign-in link is on its way to <b>{email}</b>. It expires in 15 minutes - open it on this device
                      to stay signed in here.
                    </span>
                  </p>
                  {devLink && (
                    <p className="m-note m-note--warning auth-dev">
                      <IInfo aria-hidden="true" />
                      <span>
                        Dev mode - open your link:{' '}
                        <a href={devLink}>{devLink}</a>
                      </span>
                    </p>
                  )}
                  <div className="auth-resend">
                    <button
                      type="button"
                      className="m-linkbtn"
                      onClick={() => {
                        setEmailSent(false)
                        setDevLink(null)
                        clearErrors()
                      }}
                    >
                      Use a different email
                    </button>
                  </div>
                </div>
              ) : (
                <form className="m-form" onSubmit={sendLink} noValidate>
                  <div className="m-field">
                    <label className="m-field__label" htmlFor="login-email">
                      Email address
                    </label>
                    <input
                      id="login-email"
                      ref={emailRef}
                      className="m-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="you@example.com"
                      aria-invalid={fieldError ? true : undefined}
                      aria-describedby={fieldError ? 'login-email-err' : 'login-email-hint'}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setFieldError(null)
                      }}
                    />
                    {fieldError ? (
                      <p className="m-field__error" id="login-email-err">
                        <IAlert aria-hidden="true" />
                        {fieldError}
                      </p>
                    ) : (
                      <p className="m-field__hint" id="login-email-hint">
                        We will email you a one-tap sign-in link. No password needed.
                      </p>
                    )}
                  </div>
                  <div className="m-form__actions">
                    <button className="btn btn-primary btn--block auth-submit" type="submit" disabled={blocked}>
                      {busy ? 'Sending…' : 'Email me a link'}
                    </button>
                  </div>
                </form>
              ))}

            <div className="auth-foot">
              <p className="auth-legal">
                By continuing you agree to how we handle your data, described in our{' '}
                <Link href="/privacy">privacy policy</Link>.
              </p>
              <Link href="/" className="m-linkbtn">
                Back to shop
                <IChevron aria-hidden="true" />
              </Link>
            </div>
          </main>
        </div>
      </div>
    </>
  )
}

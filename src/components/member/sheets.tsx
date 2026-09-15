'use client'

/**
 * The member area's write surfaces: the dialog primitive, the edit-profile
 * sheet and the add/edit-address sheet, plus the request-failure reader they
 * and their callers share.
 *
 * These used to be private to `src/screens/Account.tsx`, which made /account
 * the only screen that could CHANGE anything. /dashboard rendered the same
 * profile, addresses and subscriptions read-only and linked out to /account to
 * edit them — so the member's own home could show her details but not let her
 * fix a typo in one. Extracting rather than copying is the point: there is one
 * profile form and one address form in the product, so the OTP challenge on a
 * phone change, the identity-conflict handling, the state picker's tolerance of
 * legacy free-text values and the "never lose what you typed" validation cannot
 * drift between the two screens.
 *
 * Everything here is presentation over the existing /api/account/* routes. No
 * new endpoint was added, and no validation rule was relaxed in the move: the
 * client-side checks still mirror each route's zod schema exactly.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useRouter } from 'next/navigation'
import { Link } from '@/lib/router-compat'
import { Chip } from '@/components/Chip'
import { Close } from '@/components/Icons'
import { IAlert } from '@/components/AppIcons'
import { INDIA_STATES } from '@femi9/core/geo/india-states'
import type { AccountAddress, AccountUser } from '@femi9/core/services/account'

/** "+91 98842 30571" / "9884230571" → the 10 national digits a form needs. */
export function digitsOf(value: string | null | undefined): string {
  const d = (value ?? '').replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Everything a failed request can tell the UI, normalised into one shape.
 *  The API contract returns `{ error, details?.fieldErrors, code?, field?,
 *  retryAfterSec? }`, so a 400 maps to per-field errors and a 409 maps its single
 *  message onto the field it names. */
export interface ApiFailure {
  message: string
  fieldErrors: Record<string, string>
  code?: string
  field?: string
  retryAfterSec?: number
}

export async function readFailure(res: Response): Promise<ApiFailure> {
  const body = (await res.json().catch(() => null)) as {
    error?: string
    details?: { fieldErrors?: Record<string, string[] | undefined> }
    code?: string
    field?: string
    retryAfterSec?: number
  } | null

  const fieldErrors: Record<string, string> = {}
  for (const [key, messages] of Object.entries(body?.details?.fieldErrors ?? {})) {
    if (Array.isArray(messages) && messages.length > 0) fieldErrors[key] = messages[0]
  }
  // A 409 (or any coded error) names its field but carries no `details` — put its
  // message beside the input the customer typed rather than in a floating banner.
  if (body?.field && body.error && !fieldErrors[body.field]) fieldErrors[body.field] = body.error

  let message = body?.error ?? 'Something went wrong. Please try again.'
  if (typeof body?.retryAfterSec === 'number') message = `${message} Try again in ${body.retryAfterSec}s.`

  return { message, fieldErrors, code: body?.code, field: body?.field, retryAfterSec: body?.retryAfterSec }
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// ── Dialog primitive ─────────────────────────────────────────────────────────

interface SheetProps {
  onClose: () => void
  title: string
  description?: string
  wide?: boolean
  /** Where focus should land on open. Defaults to the first enabled input. */
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
}

/**
 * The accessible dialog that replaces every prompt() this screen used to open.
 * Mounted only while open, so each visit starts from clean form state and the
 * `.m-scrim` entrance transition has a frame to run from.
 */
function Sheet({ onClose, title, description, wide, initialFocus, children }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)
  const titleId = useId()

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // `is-open` has to land on a later frame than the mount, or the browser has
    // no starting opacity to transition from.
    const raf = requestAnimationFrame(() => {
      setShown(true)
      const target =
        initialFocus?.current ??
        sheetRef.current?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled])') ??
        sheetRef.current
      target?.focus()
    })

    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus()
    }
  }, [initialFocus])

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !sheetRef.current) return
    const nodes = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.getClientRects().length > 0,
    )
    if (nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className={`m-scrim${shown ? ' is-open' : ''}`}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`m-sheet${wide ? ' m-sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={sheetRef}
      >
        <div className="m-sheet__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="m-sheet__close" onClick={onClose} aria-label="Close">
            <Close aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** One field problem, rendered next to the input it belongs to. */
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="m-field__error" id={id}>
      <IAlert aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}
// ── Edit-profile dialog ──────────────────────────────────────────────────────

export function ProfileSheet({
  user,
  focus,
  notify,
  onClose,
}: {
  user: AccountUser
  focus?: 'name' | 'email' | 'phone'
  notify: (msg: string) => void
  onClose: () => void
}) {
  const router = useRouter()
  // The dialog always opens on the details form; the code step only exists once
  // a mobile-number change has actually triggered an OTP challenge.
  const [step, setStep] = useState<'details' | 'code'>('details')

  const [name, setName] = useState(user.name ?? '')
  const [email, setEmail] = useState(user.email ?? '')
  const [phone, setPhone] = useState(digitsOf(user.phone))
  const [code, setCode] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [conflictField, setConflictField] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingPhone, setPendingPhone] = useState('')
  const [cooldown, setCooldown] = useState(0)

  const nameRef = useRef<HTMLInputElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const phoneRef = useRef<HTMLInputElement | null>(null)
  const codeRef = useRef<HTMLInputElement | null>(null)
  const initialFocus = focus === 'email' ? emailRef : focus === 'phone' ? phoneRef : focus === 'name' ? nameRef : undefined

  // Resend cooldown — one second at a time, cleared when it reaches zero.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  // When the code step opens, put the caret in the code box.
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  function applyFailure(failure: ApiFailure, fallbackField?: string) {
    const fields = { ...failure.fieldErrors }
    if (Object.keys(fields).length === 0 && fallbackField) fields[fallbackField] = failure.message
    setErrors(fields)
    setConflictField(failure.code === 'identity_conflict' ? (failure.field ?? null) : null)
    setFormError(Object.keys(fields).length === 0 ? failure.message : null)
  }

  async function submitDetails(e: FormEvent) {
    e.preventDefault()
    if (saving) return

    const nextName = name.trim()
    const nextEmail = email.trim().toLowerCase()
    const nextPhone = digitsOf(phone)

    // Client-side validation mirrors the server's zod schema exactly, so a
    // correct form never round-trips to be told it is wrong.
    const found: Record<string, string> = {}
    if (nextName.length < 2 || nextName.length > 120) found.name = 'Enter your full name (2–120 characters).'
    if (!nextEmail) found.email = 'Enter your email address.'
    else if (!EMAIL_RE.test(nextEmail)) found.email = 'Enter a valid email address.'
    if (nextPhone.length !== 10) found.phone = 'Enter your 10-digit mobile number.'
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setConflictField(null)
      setFormError(null)
      const first = found.name ? nameRef : found.email ? emailRef : phoneRef
      first.current?.focus()
      return
    }

    const patch: Record<string, string> = {}
    if (nextName !== (user.name ?? '')) patch.name = nextName
    if (nextEmail !== (user.email ?? '')) patch.email = nextEmail
    // The mobile number is never written by a PATCH — it reaches a customer's
    // orders, so it only changes behind a real OTP challenge.
    const phoneChanged = nextPhone !== digitsOf(user.phone)

    if (Object.keys(patch).length === 0 && !phoneChanged) {
      onClose()
      return
    }

    setSaving(true)
    setErrors({})
    setConflictField(null)
    setFormError(null)
    try {
      if (Object.keys(patch).length > 0) {
        const res = await fetch('/api/account/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          applyFailure(await readFailure(res))
          return
        }
      }

      if (phoneChanged) {
        const res = await fetch('/api/account/phone/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: nextPhone }),
        })
        if (!res.ok) {
          applyFailure(await readFailure(res), 'phone')
          return
        }
        // Whatever the name/email step already saved is real — commit it before
        // the challenge, so abandoning the code step never loses that work.
        router.refresh()
        setPendingPhone(nextPhone)
        setCode('')
        setCooldown(30)
        setStep('code')
        return
      }

      notify('Profile updated')
      router.refresh()
      onClose()
    } catch {
      setFormError('We could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) {
      setErrors({ code: 'Enter the 6-digit code we sent you.' })
      codeRef.current?.focus()
      return
    }
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const res = await fetch('/api/account/phone/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone, code: digits }),
      })
      if (!res.ok) {
        applyFailure(await readFailure(res), 'code')
        codeRef.current?.focus()
        return
      }
      notify('Mobile number verified')
      router.refresh()
      onClose()
    } catch {
      setFormError('We could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function resend() {
    if (cooldown > 0 || saving) return
    setSaving(true)
    setErrors({})
    try {
      const res = await fetch('/api/account/phone/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone }),
      })
      if (!res.ok) {
        applyFailure(await readFailure(res), 'code')
        return
      }
      setCooldown(30)
      notify('Code sent again')
    } catch {
      setFormError('We could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const conflictLink = (field: string) =>
    conflictField === field ? (
      <>
        {' '}
        <Link to="/login">Sign in with it instead</Link>
      </>
    ) : null

  return (
    <Sheet
      onClose={onClose}
      title={step === 'code' ? 'Confirm your mobile number' : 'Edit your details'}
      description={
        step === 'code'
          ? `We sent a 6-digit code to +91 ${pendingPhone.slice(0, 5)} ${pendingPhone.slice(5)}.`
          : 'Your name is how we greet you; your email and mobile are how we reach you about an order.'
      }
      initialFocus={initialFocus}
    >
      {step === 'details' ? (
        <form className="m-form" onSubmit={submitDetails} noValidate>
          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-name">Full name</label>
            <input
              id="acct-name"
              ref={nameRef}
              className="m-input"
              type="text"
              autoComplete="name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? 'true' : undefined}
              aria-describedby={errors.name ? 'acct-name-err' : undefined}
              disabled={saving}
            />
            {errors.name && <FieldError id="acct-name-err">{errors.name}</FieldError>}
          </div>

          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-email">Email address</label>
            <input
              id="acct-email"
              ref={emailRef}
              className="m-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? 'true' : undefined}
              aria-describedby={errors.email ? 'acct-email-err' : undefined}
              disabled={saving}
            />
            {errors.email && (
              <FieldError id="acct-email-err">
                {errors.email}
                {conflictLink('email')}
              </FieldError>
            )}
          </div>

          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-phone">Mobile number</label>
            <input
              id="acct-phone"
              ref={phoneRef}
              className="m-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={phone}
              maxLength={10}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              aria-invalid={errors.phone ? 'true' : undefined}
              aria-describedby={errors.phone ? 'acct-phone-err' : 'acct-phone-hint'}
              disabled={saving}
            />
            <p className="m-field__hint" id="acct-phone-hint">
              Changing this sends a 6-digit code to the new number before we save it.
            </p>
            {errors.phone && (
              <FieldError id="acct-phone-err">
                {errors.phone}
                {conflictLink('phone')}
              </FieldError>
            )}
          </div>

          {formError && (
            <p className="m-field__error" role="alert">
              <IAlert aria-hidden="true" />
              <span>{formError}</span>
            </p>
          )}

          <div className="m-sheet__foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : (
        <form className="m-form" onSubmit={submitCode} noValidate>
          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-code">6-digit code</label>
            <input
              id="acct-code"
              ref={codeRef}
              className="m-input acct-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-invalid={errors.code ? 'true' : undefined}
              aria-describedby={errors.code ? 'acct-code-err' : undefined}
              disabled={saving}
            />
            {errors.code && <FieldError id="acct-code-err">{errors.code}</FieldError>}
          </div>

          <div className="acct-code__actions">
            <button type="button" className="m-linkbtn" onClick={() => void resend()} disabled={cooldown > 0 || saving}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              className="m-linkbtn"
              onClick={() => {
                setStep('details')
                setErrors({})
                setFormError(null)
              }}
              disabled={saving}
            >
              Change number
            </button>
          </div>

          {formError && (
            <p className="m-field__error" role="alert">
              <IAlert aria-hidden="true" />
              <span>{formError}</span>
            </p>
          )}

          <div className="m-sheet__foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Verifying…' : 'Verify number'}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  )
}

// ── Add / edit address dialog ────────────────────────────────────────────────

const PRESET_LABELS = ['Home', 'Work', 'Other'] as const

export function AddressSheet({
  address,
  defaultName,
  defaultPhone,
  notify,
  onClose,
}: {
  address: AccountAddress | null
  defaultName: string
  defaultPhone: string
  notify: (msg: string) => void
  onClose: () => void
}) {
  const router = useRouter()
  const editing = address !== null
  const preset = address ? (PRESET_LABELS as readonly string[]).includes(address.label) : true

  const [labelChoice, setLabelChoice] = useState<string>(address ? (preset ? address.label : 'Other') : 'Home')
  const [customLabel, setCustomLabel] = useState(address && !preset ? address.label : '')
  const [name, setName] = useState(address?.name ?? defaultName)
  const [line, setLine] = useState(address?.line ?? '')
  // cityRaw / state / pincode are the raw columns, so the form prefills without
  // having to re-parse the composed "City, State 641001" display line.
  const [city, setCity] = useState(address?.cityRaw ?? '')
  const [state, setState] = useState(address?.state ?? '')
  const [pincode, setPincode] = useState(address?.pincode ?? '')
  const [phone, setPhone] = useState(digitsOf(address?.phone ?? defaultPhone))
  // Unchecking "default" would leave the account with no default at all, so the
  // control simply does not exist for an address that is already the default —
  // you promote a different one instead.
  const alreadyDefault = address?.primary === true
  const [isPrimary, setIsPrimary] = useState(false)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Legacy rows can carry a free-text state that predates this picker. Keeping
  // it as an option means editing an address never silently drops it.
  const stateOptions = useMemo(() => {
    const list: string[] = [...INDIA_STATES]
    const current = address?.state?.trim()
    if (current && !list.includes(current)) list.unshift(current)
    return list
  }, [address])

  const labelRef = useRef<HTMLInputElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const lineRef = useRef<HTMLTextAreaElement | null>(null)
  const cityRef = useRef<HTMLInputElement | null>(null)
  const pinRef = useRef<HTMLInputElement | null>(null)
  const phoneRef = useRef<HTMLInputElement | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return

    const label = (labelChoice === 'Other' ? customLabel : labelChoice).trim()
    const payload = {
      label,
      name: name.trim(),
      line: line.trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      phone: digitsOf(phone),
      ...(alreadyDefault ? {} : { isPrimary }),
    }

    // Mirrors the route's zod schema so nothing the customer typed is lost to a
    // round-trip — and nothing they typed is ever discarded on failure either.
    const found: Record<string, string> = {}
    if (!payload.label || payload.label.length > 40) found.label = 'Give this address a short name (up to 40 characters).'
    if (payload.name.length < 2 || payload.name.length > 120) found.name = "Enter the recipient's full name."
    if (payload.line.length < 3 || payload.line.length > 300) found.line = 'Enter the house or flat, street and area.'
    if (payload.city.length < 2 || payload.city.length > 120) found.city = 'Enter the city or town.'
    if (payload.pincode && !/^\d{6}$/.test(payload.pincode)) found.pincode = 'A pincode is exactly 6 digits.'
    if (payload.phone && payload.phone.length !== 10) found.phone = 'A mobile number is exactly 10 digits.'
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setFormError(null)
      const first = found.label
        ? labelRef
        : found.name
          ? nameRef
          : found.line
            ? lineRef
            : found.city
              ? cityRef
              : found.pincode
                ? pinRef
                : phoneRef
      first.current?.focus()
      return
    }

    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const res = await fetch(
        address ? `/api/account/addresses/${address.id}` : '/api/account/addresses',
        {
          method: address ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const failure = await readFailure(res)
        setErrors(failure.fieldErrors)
        setFormError(Object.keys(failure.fieldErrors).length === 0 ? failure.message : null)
        return
      }
      notify(editing ? 'Address updated' : 'Address saved')
      router.refresh()
      onClose()
    } catch {
      setFormError('We could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      wide
      title={editing ? 'Edit address' : 'Add a delivery address'}
      description="Every field is on this one screen - nothing you type is lost if something needs fixing."
    >
      <form className="m-form" onSubmit={submit} noValidate>
        <div className="m-field">
          <span className="m-field__label" id="acct-label-legend">Label</span>
          <div className="acct-chips" role="group" aria-labelledby="acct-label-legend">
            {PRESET_LABELS.map((option) => (
              <Chip
                key={option}
                selected={labelChoice === option}
                onClick={() => setLabelChoice(option)}
                disabled={saving}
              >
                {option}
              </Chip>
            ))}
          </div>
          {labelChoice === 'Other' && (
            <input
              ref={labelRef}
              className="m-input"
              type="text"
              value={customLabel}
              maxLength={40}
              placeholder="Mum's place, hostel, studio…"
              aria-label="Custom address label"
              onChange={(e) => setCustomLabel(e.target.value)}
              aria-invalid={errors.label ? 'true' : undefined}
              aria-describedby={errors.label ? 'acct-label-err' : undefined}
              disabled={saving}
            />
          )}
          {errors.label && <FieldError id="acct-label-err">{errors.label}</FieldError>}
        </div>

        <div className="m-field">
          <label className="m-field__label" htmlFor="acct-addr-name">Recipient name</label>
          <input
            id="acct-addr-name"
            ref={nameRef}
            className="m-input"
            type="text"
            autoComplete="name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? 'true' : undefined}
            aria-describedby={errors.name ? 'acct-addr-name-err' : undefined}
            disabled={saving}
          />
          {errors.name && <FieldError id="acct-addr-name-err">{errors.name}</FieldError>}
        </div>

        <div className="m-field">
          <label className="m-field__label" htmlFor="acct-line">House / flat, street and area</label>
          <textarea
            id="acct-line"
            ref={lineRef}
            className="m-textarea"
            autoComplete="street-address"
            value={line}
            maxLength={300}
            onChange={(e) => setLine(e.target.value)}
            aria-invalid={errors.line ? 'true' : undefined}
            aria-describedby={errors.line ? 'acct-line-err' : undefined}
            disabled={saving}
          />
          {errors.line && <FieldError id="acct-line-err">{errors.line}</FieldError>}
        </div>

        <div className="m-form__grid">
          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-city">City</label>
            <input
              id="acct-city"
              ref={cityRef}
              className="m-input"
              type="text"
              autoComplete="address-level2"
              value={city}
              maxLength={120}
              onChange={(e) => setCity(e.target.value)}
              aria-invalid={errors.city ? 'true' : undefined}
              aria-describedby={errors.city ? 'acct-city-err' : undefined}
              disabled={saving}
            />
            {errors.city && <FieldError id="acct-city-err">{errors.city}</FieldError>}
          </div>

          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-state">
              State <span>(optional)</span>
            </label>
            <select
              id="acct-state"
              className="m-select"
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={saving}
            >
              <option value="">Select a state</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-pincode">
              Pincode <span>(optional)</span>
            </label>
            <input
              id="acct-pincode"
              ref={pinRef}
              className="m-input m-num"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              value={pincode}
              maxLength={6}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-invalid={errors.pincode ? 'true' : undefined}
              aria-describedby={errors.pincode ? 'acct-pincode-err' : undefined}
              disabled={saving}
            />
            {errors.pincode && <FieldError id="acct-pincode-err">{errors.pincode}</FieldError>}
          </div>

          <div className="m-field">
            <label className="m-field__label" htmlFor="acct-addr-phone">
              Delivery phone <span>(optional)</span>
            </label>
            <input
              id="acct-addr-phone"
              ref={phoneRef}
              className="m-input m-num"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={phone}
              maxLength={10}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              aria-invalid={errors.phone ? 'true' : undefined}
              aria-describedby={errors.phone ? 'acct-addr-phone-err' : undefined}
              disabled={saving}
            />
            {errors.phone && <FieldError id="acct-addr-phone-err">{errors.phone}</FieldError>}
          </div>
        </div>

        {alreadyDefault ? (
          <p className="m-cap">This is your default delivery address.</p>
        ) : (
          <label className="acct-check">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              disabled={saving}
            />
            <span>Deliver here by default</span>
          </label>
        )}

        {formError && (
          <p className="m-field__error" role="alert">
            <IAlert aria-hidden="true" />
            <span>{formError}</span>
          </p>
        )}

        <div className="m-sheet__foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save address' : 'Add address'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

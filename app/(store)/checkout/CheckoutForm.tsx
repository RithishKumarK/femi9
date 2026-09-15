'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/store/cart'
import { Chip } from '@/components/Chip'
import { track } from '@/lib/track'

/**
 * Checkout form — collects shipping details, POSTs /api/checkout, then drives
 * the payment step returned in that response.
 *
 * On checkout success we refresh the client cart mirror (so the drawer empties
 * to match the now-deleted server cart) and then, depending on the payment
 * intent the server hands back:
 *   • configured (live Razorpay keys) → load Checkout.js, open the modal, and on
 *     a successful payment POST the handles to /api/payments/verify before
 *     routing to the confirmation. A dismissed modal routes to the pending
 *     order page so the shopper is not left on a checkout whose cart is gone.
 *   • not configured (test/mock mode) → there is no gateway, so we POST
 *     { mock:true } to /api/payments/verify to simulate a capture, and say so
 *     honestly with a "Test mode" note before routing.
 *
 * Server-side failures surface inline; the out-of-stock 409 message is shown
 * verbatim so the shopper knows exactly which item to fix.
 *
 * Styling stays on the storefront's tokens (var(--…)) + the shared .btn classes,
 * deliberately NOT the admin .adm-* system.
 */

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

// The payment intent mirrored from PlaceOrderResult.payment (see checkout.ts):
// `amount` is in RUPEES (matches Order.total); Razorpay wants PAISE, so we ×100
// only at the moment we hand it to the widget.
interface PaymentIntent {
  razorpayOrderId: string
  amount: number
  keyId: string
  configured: boolean
}

type CheckoutResponse = { orderNo?: string; payment?: PaymentIntent; token?: string; error?: string }

// Minimal shape of the Razorpay Checkout global we call into. Hand-declared
// (instead of pulling in @types/razorpay) to keep the dependency footprint nil.
interface RazorpaySuccess {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}
interface RazorpayOptions {
  key: string
  amount: number // paise
  currency: string
  name: string
  order_id: string
  prefill?: { name?: string; email?: string; contact?: string }
  handler?: (res: RazorpaySuccess) => void
  modal?: { ondismiss?: () => void }
}
interface RazorpayInstance {
  open: () => void
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

// Inject Checkout.js once, on demand (only shoppers with live keys ever load it),
// and resolve when window.Razorpay is ready. Resolves false on any load failure
// so the caller can fall back to an inline error rather than a dead button.
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false)
    if (window.Razorpay) return resolve(true)

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT_SRC}"]`)
    if (existing) {
      if (window.Razorpay) return resolve(true)
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve(Boolean(window.Razorpay))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

type Field =
  | 'name'
  | 'phone'
  | 'email'
  | 'line'
  | 'city'
  | 'state'
  | 'pincode'
  | 'couponCode'
  | 'addressLabel'

const EMPTY: Record<Field, string> = {
  name: '',
  phone: '',
  email: '',
  line: '',
  city: '',
  state: '',
  pincode: '',
  couponCode: '',
  addressLabel: 'Home',
}

/**
 * Indian states and union territories, for the State picker.
 *
 * A free-text State box on a phone is a 133px field, an open keyboard and no
 * validation — "TN", "tamilnadu" and outright typos all reached the shipping
 * label. A native <select> renders as a scroll wheel on iOS and a full-screen
 * list on Android, so it costs no keyboard at all.
 */
const STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const

/** What we already know about a signed-in shopper, resolved server-side. */
export interface CheckoutPrefill {
  name?: string | null
  phone?: string | null
  email?: string | null
  line?: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
  addressLabel?: string | null
}

export function CheckoutForm({ prefill }: { prefill?: CheckoutPrefill }) {
  const router = useRouter()
  const { refresh } = useCart()

  // Seed from the account and its primary address so a signed-in shopper is not
  // retyping her own name, number and street on every order. Fields stay fully
  // editable — this is a starting point, not a lock.
  const [form, setForm] = useState<Record<Field, string>>(() => ({
    ...EMPTY,
    name: prefill?.name ?? '',
    phone: prefill?.phone ?? '',
    email: prefill?.email ?? '',
    line: prefill?.line ?? '',
    city: prefill?.city ?? '',
    state: prefill?.state ?? '',
    pincode: prefill?.pincode ?? '',
    addressLabel: prefill?.addressLabel ?? 'Home',
  }))
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  // Informational, non-error note (currently used for test-mode disclosure).
  const [note, setNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: Field, value: string) => setForm((f) => ({ ...f, [key]: value }))

  // Phone/pincode are digit-only; strip as the user types so validation is simple.
  const onDigits = (key: Field, value: string, max: number) => set(key, value.replace(/\D/g, '').slice(0, max))

  function validate(): boolean {
    const next: Partial<Record<Field, string>> = {}
    if (!form.name.trim()) next.name = 'Please enter your name.'
    if (form.phone.length !== 10) next.phone = 'Enter your 10-digit mobile number.'
    if (!form.line.trim()) next.line = 'Please enter your address.'
    if (!form.city.trim()) next.city = 'Please enter your city.'
    if (form.pincode && form.pincode.length !== 6) next.pincode = 'Enter a valid 6-digit pincode.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  // POST the verify payload (live handles or { mock:true }). Returns whether the
  // capture was accepted; the confirmation page reflects the true order status
  // regardless, so callers navigate either way and only surface hard failures.
  async function postVerify(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    return Boolean(res && res.ok)
  }

  // Mock mode: no gateway to open, so simulate a captured payment against the
  // pending order and be upfront that it's a test.
  async function simulateMockPayment(orderNo: string, token: string) {
    setNote('Test mode - simulating payment…')
    const okv = await postVerify({ orderNo, mock: true })
    if (okv) track('purchase', { orderNo, mode: 'mock' })
    if (!okv) {
      setFormError('We could not confirm the test payment. Please try again.')
      setNote(null)
      setSubmitting(false)
      return
    }
    router.push('/order/' + orderNo + '?t=' + token)
  }

  // Live mode: open the Razorpay Checkout modal for the gateway order the server
  // opened. On success we verify the signature server-side then route; on dismiss
  // the order stays pending and we route to its truthful status page.
  async function openRazorpay(orderNo: string, payment: PaymentIntent, token: string) {
    const ready = await loadRazorpayScript()
    if (!ready || !window.Razorpay) {
      setFormError('We could not load the payment window. Please check your connection and try again.')
      setSubmitting(false)
      return
    }

    const rzp = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amount * 100, // rupees → paise for the widget
      currency: 'INR',
      name: 'Femi9',
      order_id: payment.razorpayOrderId,
      prefill: {
        name: form.name,
        email: form.email.trim() || undefined,
        contact: form.phone,
      },
      handler: (res) => {
        track('purchase', { orderNo, mode: 'razorpay' })
        // Route to the confirmation regardless of the verify outcome: the page
        // reads the live order status, so a verify hiccup still shows the truthful
        // pending/paid state (and the webhook can still finalize it).
        void postVerify({
          razorpay_order_id: res.razorpay_order_id,
          razorpay_payment_id: res.razorpay_payment_id,
          razorpay_signature: res.razorpay_signature,
          orderNo,
        }).finally(() => router.push('/order/' + orderNo + '?t=' + token))
      },
      modal: {
        ondismiss: () => {
          // The cart was consumed when the pending order was created, so keeping
          // the shopper on checkout would leave them with no valid retry path.
          router.push('/order/' + orderNo + '?t=' + token)
        },
      },
    })
    rzp.open()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setNote(null)
    if (!validate()) return

    setSubmitting(true)
    // /api/events had no client instrumentation at all; checkout start and
    // purchase are the two events the funnel is actually measured on.
    track('checkout_start', {})
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = (await res.json().catch(() => ({}))) as CheckoutResponse

      if (!res.ok) {
        // 409 out-of-stock / 400 empty-or-invalid — show the server's message.
        setFormError(data.error ?? 'Sorry, we could not place your order. Please try again.')
        setSubmitting(false)
        return
      }

      // Empty the drawer to match the server (cart was deleted), then pay.
      await refresh()

      const orderNo = data.orderNo
      if (!orderNo) {
        setFormError('Sorry, we could not place your order. Please try again.')
        setSubmitting(false)
        return
      }

      // Capability token that authorizes the confirmation page (guests have no
      // session); carried through to the /order/<no>?t=<token> navigation.
      const token = data.token ?? ''

      // Hand off to the right payment flow. `submitting` stays true across the
      // async payment step so the button remains disabled; hard failures re-enable
      // it, while a modal dismissal routes to the pending-order page.
      if (data.payment?.configured) {
        await openRazorpay(orderNo, data.payment, token)
      } else {
        await simulateMockPayment(orderNo, token)
      }
    } catch {
      setFormError('Network error. Please check your connection and try again.')
      setSubmitting(false)
    }
  }

  return (
    // Shipping-details card. Depth + soft geometry live in craft-checkout.css
    // (.co-form) rather than inline, so the polish pass owns the elevation.
    <form onSubmit={onSubmit} noValidate className="co-form">
      <h2 style={{ fontSize: '1.15rem', marginBottom: '1.25rem' }}>Shipping details</h2>

      <div className="co-fields">
        <FormField label="Full name" error={errors.name} full>
          <input
            className="co-input"
            type="text"
            autoComplete="name"
            placeholder="e.g. Lakshmi Priya"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={!!errors.name}
          />
        </FormField>

        <FormField label="Phone number" error={errors.phone}>
          <input
            className="co-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="10-digit mobile"
            value={form.phone}
            onChange={(e) => onDigits('phone', e.target.value, 10)}
            aria-invalid={!!errors.phone}
          />
        </FormField>

        <FormField label="Email (optional)" error={errors.email}>
          <input
            className="co-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </FormField>

        <FormField label="Address" error={errors.line} full>
          <input
            className="co-input"
            type="text"
            autoComplete="street-address"
            placeholder="House / flat, street, area"
            value={form.line}
            onChange={(e) => set('line', e.target.value)}
            aria-invalid={!!errors.line}
          />
        </FormField>

        <FormField label="City" error={errors.city}>
          <input
            className="co-input"
            type="text"
            autoComplete="address-level2"
            placeholder="e.g. Coimbatore"
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
            aria-invalid={!!errors.city}
          />
        </FormField>

        <FormField label="State (optional)">
          <select
            className="co-select"
            autoComplete="address-level1"
            value={form.state}
            onChange={(e) => set('state', e.target.value)}
          >
            <option value="">Select state</option>
            {/* A prefilled address may hold a value typed before this was a
                picker ("TN", a typo). Keep it selectable so switching the
                control does not silently blank a saved address. */}
            {form.state && !STATES.includes(form.state as (typeof STATES)[number]) && (
              <option value={form.state}>{form.state}</option>
            )}
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Pincode (optional)" error={errors.pincode}>
          <input
            className="co-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="postal-code"
            placeholder="6-digit pincode"
            value={form.pincode}
            onChange={(e) => onDigits('pincode', e.target.value, 6)}
            aria-invalid={!!errors.pincode}
          />
        </FormField>

        {/* The customer's own name for this address. It is saved to her address
            book and reused on the next order, so it has to be her word — every
            address in the system used to be stamped 'Home' regardless. */}
        <FormField label="Save this address as" full>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['Home', 'Work', 'Other'].map((option) => (
              <Chip
                key={option}
                selected={form.addressLabel === option}
                onClick={() => set('addressLabel', option)}
              >
                {option}
              </Chip>
            ))}
          </div>
        </FormField>

        <FormField label="Coupon or reward code (optional)" full>
          <input
            className="co-input"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. BLOOM-XXXXXXXXXX"
            value={form.couponCode}
            onChange={(e) => set('couponCode', e.target.value.toUpperCase())}
          />
        </FormField>
      </div>

      {formError && (
        <p
          role="alert"
          style={{
            marginTop: '1.1rem',
            padding: '.7rem .9rem',
            borderRadius: 'var(--cr-r-sm)',
            background: 'rgba(216,162,47,.12)',
            border: '1px solid rgba(216,162,47,.4)',
            color: 'var(--navy)',
            fontSize: '.88rem',
            lineHeight: 1.45,
          }}
        >
          {formError}
        </p>
      )}

      {/* On a phone the CTA sat ~1200px down the page; .co-paybar makes this a
          sticky footer inside the form below 720px so it is always reachable.
          Above 720px the wrapper is inert and the button renders as before. */}
      <div className="co-paybar">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting}
          style={{ width: '100%', opacity: submitting ? 0.75 : 1 }}
        >
          {submitting ? 'Preparing payment…' : 'Continue to secure payment'}
        </button>
      </div>

      <p className="co-note">Pay securely with Razorpay. UPI, cards and netbanking are supported.</p>
    </form>
  )
}

/** Labeled field wrapper; `full` spans both grid columns. */
function FormField({
  label,
  error,
  full,
  children,
}: {
  label: string
  error?: string
  full?: boolean
  children: React.ReactNode
}) {
  return (
    // Deliberately a <div> + unassociated <label>, as before: one of these
    // fields wraps a row of Chip <button>s, and <button> is a labelable
    // element — a wrapping <label> would make a click on the label text
    // activate the first chip.
    <div className={full ? 'co-field co-field--full' : 'co-field'}>
      <label className="co-label">{label}</label>
      {children}
      {/* role="alert" so a validation failure is announced, not just painted. */}
      {error && (
        <span className="co-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

type PaymentIntent = {
  razorpayOrderId: string
  amount: number
  keyId: string
  configured: boolean
}

type RazorpaySuccess = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayConstructor = new (options: Record<string, unknown>) => { open: () => void }
const razorpayConstructor = () =>
  (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (razorpayConstructor()) return resolve(true)
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(razorpayConstructor())), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve(Boolean(razorpayConstructor()))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export function RetryPaymentButton({ orderNo, token }: { orderNo: string; token?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verify(body: Record<string, unknown>) {
    const response = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, orderNo }),
    })
    if (!response.ok) throw new Error('Payment verification failed')
    router.refresh()
  }

  async function retry() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNo)}/payment-intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token || '' }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        payment?: PaymentIntent
        error?: string
      }
      if (!response.ok || !data.payment) throw new Error(data.error || 'Could not prepare payment')

      if (!data.payment.configured) {
        await verify({ mock: true })
        return
      }

      const Razorpay = (await loadRazorpay()) ? razorpayConstructor() : undefined
      if (!Razorpay) {
        throw new Error('Could not load the secure payment window')
      }
      const payment = data.payment
      new Razorpay({
        key: payment.keyId,
        amount: payment.amount * 100,
        currency: 'INR',
        name: 'Femi9',
        order_id: payment.razorpayOrderId,
        handler: (result: RazorpaySuccess) => {
          void verify({
            razorpay_order_id: result.razorpay_order_id,
            razorpay_payment_id: result.razorpay_payment_id,
            razorpay_signature: result.razorpay_signature,
          }).catch(() => setError('Payment was received but confirmation is delayed. Refresh shortly.'))
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare payment')
      setBusy(false)
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" onClick={retry} disabled={busy}>
        {busy ? 'Preparing payment…' : 'Retry secure payment'}
      </button>
      {/* These messages carry "Payment was received but confirmation is
          delayed" — they have to be announced and to read as an alert, not as
          more of the plum panel's reassurance copy. */}
      {error ? (
        <p
          role="alert"
          style={{ marginTop: '.75rem', fontSize: '.9rem', lineHeight: 1.45, color: '#FFD9DF', fontWeight: 500 }}
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

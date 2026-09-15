/**
 * Client-side mandate authorisation — the second half of starting a subscription.
 *
 * `POST /api/subscriptions` creates the plan and the Razorpay subscription but
 * authorises nothing; until the customer's bank or UPI app approves the mandate,
 * NOTHING is ever debited and the plan sits `pending_mandate`. This module opens
 * that approval sheet and reports the outcome back to the server.
 *
 * It is deliberately UI-free so both the product page and the account page can
 * call it — one of them starts a plan, the other finishes one the shopper
 * abandoned, and the gateway dance is identical.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

export interface MandateAuthorization {
  subscriptionId: string
  razorpaySubscriptionId: string
  keyId: string
  amount: number
  configured: boolean
}

/** What Checkout hands back once the mandate is approved. Note the fields: a
 *  mandate returns a SUBSCRIPTION id where a one-off payment returns an order
 *  id, and the signature covers a different string because of it. */
type MandateSuccess = {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

type RazorpayConstructor = new (options: Record<string, unknown>) => {
  open: () => void
  on?: (event: string, handler: (payload: unknown) => void) => void
}

const razorpayConstructor = () => (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay

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

export type MandateOutcome =
  | { ok: true }
  /** The shopper closed the sheet. Her plan is still there, still unauthorised,
   *  and the account page offers to finish it — so this is NOT an error and must
   *  not be reported as one. */
  | { ok: false; dismissed: true }
  | { ok: false; dismissed: false; message: string }

async function confirm(subscriptionId: string, body: Record<string, unknown>): Promise<MandateOutcome> {
  const res = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true }
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return {
    ok: false,
    dismissed: false,
    message: data?.error ?? 'We could not confirm your payment method. Please try again.',
  }
}

/**
 * Open Razorpay Checkout in mandate mode and confirm the result server-side.
 *
 * Resolves only once the outcome is known. The `modal.ondismiss` path resolves
 * as `dismissed` rather than rejecting: a shopper who changes her mind at the
 * bank screen has not hit an error, and telling her she has is how a normal
 * hesitation turns into a support ticket.
 */
export async function authorizeMandate(
  auth: MandateAuthorization,
  opts?: { name?: string; email?: string; contact?: string; description?: string },
): Promise<MandateOutcome> {
  // No gateway configured (local/dev): there is no sheet to open and nothing to
  // sign, so confirm through the server's explicit mock branch. That branch is
  // refused the moment real keys exist, so this cannot bypass a live mandate.
  if (!auth.configured) return confirm(auth.subscriptionId, { mock: true })

  const Razorpay = (await loadRazorpay()) ? razorpayConstructor() : undefined
  if (!Razorpay) {
    return {
      ok: false,
      dismissed: false,
      message: 'We could not reach the payment provider. Check your connection and try again.',
    }
  }

  return new Promise<MandateOutcome>((resolve) => {
    let settled = false
    const settle = (outcome: MandateOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    const checkout = new Razorpay({
      key: auth.keyId,
      // `subscription_id`, NOT `order_id`. This is what puts Checkout into
      // mandate mode and shows the customer the recurring-authorisation screen
      // instead of a one-off payment screen.
      subscription_id: auth.razorpaySubscriptionId,
      name: 'Femi9',
      description: opts?.description ?? 'Subscription',
      prefill: { name: opts?.name, email: opts?.email, contact: opts?.contact },
      handler: (result: MandateSuccess) => {
        void confirm(auth.subscriptionId, {
          razorpay_subscription_id: result.razorpay_subscription_id,
          razorpay_payment_id: result.razorpay_payment_id,
          razorpay_signature: result.razorpay_signature,
        }).then(settle)
      },
      modal: {
        ondismiss: () => settle({ ok: false, dismissed: true }),
      },
    })

    // A failed authorisation (bank declined, mandate refused) fires this rather
    // than `handler`. Without it the promise would never settle and the button
    // would spin forever.
    checkout.on?.('payment.failed', () =>
      settle({
        ok: false,
        dismissed: false,
        message: 'Your bank did not approve the mandate. Try another payment method.',
      }),
    )

    checkout.open()
  })
}

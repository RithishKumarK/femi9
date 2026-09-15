import Link from 'next/link'
import { getSession } from '@femi9/core/auth'
import { prisma } from '@/lib/db'
import { getGuestToken } from '@/lib/session'
import { EMPTY_CART, getCart } from '@femi9/core/services/cart'
import { resolveZone } from '@femi9/core/services/pricing'
import { getSettings } from '@femi9/core/services/settings'
import { rupees } from '@/data/products'
import { CheckoutForm, type CheckoutPrefill } from './CheckoutForm'

// Route-scoped sheet — keeps the money path off the shared stylesheets whose
// load order app/layout.tsx pins deliberately.
import './checkout.css'
import '@/styles/craft-checkout.css'

// Reads the guest cookie + live cart, so it must render per-request, never cached.
export const dynamic = 'force-dynamic'

// Mirror of the service's flat courier fee — this is the DISPLAY summary; the
// order route recomputes the same numbers authoritatively at submit time.
const SHIPPING_FEE = 49

/**
 * What we already know about a signed-in shopper: her account details plus her
 * primary saved address. Nothing here is required — a guest simply gets an empty
 * form — but a returning customer should never be retyping her own street.
 */
async function resolvePrefill(): Promise<CheckoutPrefill | undefined> {
  const session = await getSession('femi9')
  if (!session) return undefined

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      name: true,
      email: true,
      phone: true,
      addresses: {
        where: { archivedAt: null },
        // Address carries no createdAt; cuid() ids are timestamp-prefixed and
        // therefore sort in creation order, so this is still "newest first".
        orderBy: [{ isPrimary: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { label: true, name: true, line: true, city: true, state: true, pincode: true, phone: true },
      },
    },
  })
  if (!user) return undefined

  const addr = user.addresses[0]
  return {
    name: addr?.name ?? user.name,
    phone: addr?.phone ?? user.phone,
    email: user.email,
    line: addr?.line,
    city: addr?.city,
    state: addr?.state,
    pincode: addr?.pincode,
    addressLabel: addr?.label,
  }
}

export default async function CheckoutPage() {
  const token = await getGuestToken()
  const [{ freeShipThreshold }, prefill] = await Promise.all([
    getSettings('femi9').catch(() => ({ freeShipThreshold: 999 })),
    resolvePrefill().catch(() => undefined),
  ])

  // Price the summary at the zone for the address this order will actually ship
  // to. The prefilled address is what the form submits unless she edits it, so
  // it beats the ambient (edge-geo) guess; with no prefill we fall back to that
  // guess by leaving `zone` undefined. Either way `placeOrder` re-resolves from
  // the submitted address and is the authority — this only decides what she is
  // SHOWN, which previously ignored zones entirely and quoted her a total the
  // payment sheet then contradicted.
  const zone =
    prefill?.state || prefill?.pincode
      ? await resolveZone('femi9', { state: prefill.state, pincode: prefill.pincode }).catch(() => null)
      : undefined

  const cart = token ? await getCart('femi9', token, zone).catch(() => EMPTY_CART) : EMPTY_CART

  if (cart.items.length === 0) {
    return (
      <main className="wrap section" style={{ textAlign: 'center', maxWidth: 640 }}>
        <span className="eyebrow">Checkout</span>
        <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', margin: '.4em 0 .3em' }}>Your bag is empty</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.6rem' }}>
          Add something you love, then come back to check out.
        </p>
        <Link href="/shop" className="btn btn-primary">
          Shop pads
        </Link>
      </main>
    )
  }

  const shipping = cart.subtotal >= freeShipThreshold ? 0 : SHIPPING_FEE
  const total = cart.subtotal + shipping

  // How much the zone took OFF. A zone can now also price an item by hand, and a
  // typed price is not guaranteed to be lower than the standard one — so this is
  // computed, not assumed. When it isn't positive there is nothing to strike
  // through and the summary simply quotes the zone price as the subtotal.
  const zoneSaving = cart.baseSubtotal - cart.subtotal
  const showsSaving = cart.zone !== null && zoneSaving > 0

  return (
    <main className="wrap section" style={{ maxWidth: 1040 }}>
      <span className="eyebrow">Checkout</span>
      <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', margin: '.35em 0 1.4rem' }}>Almost there</h1>

      <div
        style={{
          display: 'grid',
          gap: 'clamp(24px,4vw,40px)',
          // auto-fit stacks to one column on narrow screens without a media query,
          // so the page never scrolls horizontally on mobile.
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          alignItems: 'start',
        }}
      >
        {/* Shipping details — primary action.
            Stays FIRST in the DOM (so it is what a screen reader and the tab
            order reach first) — checkout.css lifts the summary above it visually
            below 720px, where stacking otherwise put the Total ~400px BELOW the
            pay button. */}
        <CheckoutForm prefill={prefill} />

        {/* Order summary — recomputed from the server cart.
            `position:sticky` now lives in checkout.css behind a min-width query:
            inline it also applied to the stacked mobile layout, where it does
            nothing (the aside's grid area is exactly its own height) and could
            not be undone from CSS. */}
        <aside
          className="co-summary"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line-soft)',
            borderRadius: 'var(--r-card)',
            boxShadow: 'var(--shadow-sm)',
            padding: 'clamp(20px,3vw,28px)',
          }}
        >
          <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem' }}>Order summary</h2>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '1rem' }}>
            {cart.items.map((it) => (
              <li key={it.variantId} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    flex: '0 0 auto',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'var(--cream-2)',
                  }}
                >
                  {it.img ? (
                    // Stays a plain <img>: `it.img` is an admin-uploaded URL
                    // resolved at request time, so it is not in the OptImg
                    // manifest and has no pre-built ladder. width/height match
                    // the 52px box, and the decode is deferred.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.img}
                      alt={it.name}
                      width={52}
                      height={52}
                      loading="lazy"
                      decoding="async"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '.95rem' }}>{it.name}</div>
                  <div className="co-meta" style={{ color: 'var(--muted)' }}>
                    {it.variantLabel} · Qty {it.qty}
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: '.9rem', whiteSpace: 'nowrap' }}>
                  {rupees(it.lineTotal)}
                </div>
              </li>
            ))}
          </ul>

          <div style={{ borderTop: '1px solid var(--line-soft)', margin: '1.2rem 0', paddingTop: '1rem', display: 'grid', gap: '.55rem' }}>
            <Row label="Subtotal" value={rupees(showsSaving ? cart.baseSubtotal : cart.subtotal)} />
            {/* A regional discount is money off her order; she should see it
                named, not discover a smaller number at the Razorpay sheet.
                The percentage is only named when it is what actually priced the
                cart — with a custom price set for an item it is not, and
                printing it would be a promise the total doesn't keep. */}
            {showsSaving && cart.zone ? (
              <Row
                label={
                  cart.zone.custom || cart.zone.discountPct <= 0
                    ? `${cart.zone.name} pricing`
                    : `${cart.zone.name} pricing (−${cart.zone.discountPct}%)`
                }
                value={`− ${rupees(zoneSaving)}`}
                muted
              />
            ) : null}
            <Row label="Shipping" value={shipping === 0 ? 'Free' : rupees(shipping)} muted={shipping === 0} />
          </div>

          <div
            style={{
              borderTop: '1px solid var(--line)',
              paddingTop: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              fontWeight: 700,
              fontSize: '1.1rem',
            }}
          >
            <span>Total</span>
            <span>{rupees(total)}</span>
          </div>

          <p className="co-note" style={{ marginTop: '1rem', textAlign: 'left' }}>
            {cart.zone
              ? 'Regional pricing follows your delivery address. Your total is recomputed securely on the server before Razorpay opens.'
              : 'Your total is recomputed securely on the server before Razorpay opens.'}
          </p>
        </aside>
      </div>
    </main>
  )
}

/** A single label/value line in the summary. */
function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.92rem' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: muted ? 'var(--forest-2)' : 'var(--ink)' }}>{value}</span>
    </div>
  )
}

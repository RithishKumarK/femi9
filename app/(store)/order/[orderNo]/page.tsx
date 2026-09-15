import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrderByNo } from '@femi9/core/services/checkout'
import { verifyOrderToken } from '@femi9/core/order-token'
import { getSession } from '@femi9/core/auth'
import { prisma } from '@/lib/db'
import { rupees } from '@/data/products'
import { getSettings } from '@femi9/core/services/settings'
import { RetryPaymentButton } from './RetryPaymentButton'

// Confirmation reflects live order state, so render per-request.
export const dynamic = 'force-dynamic'

// Human labels for the statuses a fresh order can be in. 'pending' means the
// order exists but payment isn't captured yet (Razorpay lands in a later phase).
const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting payment confirmation',
  paid: 'Payment received',
  processing: 'Being packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

export default async function OrderConfirmationPage(
  props: {
    params: Promise<{ orderNo: string }>
    searchParams: Promise<{ t?: string | string[] }>
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const [order, settings] = await Promise.all([getOrderByNo('femi9', params.orderNo), getSettings('femi9')])
  if (!order) notFound()

  // The page exposes customer PII (name/address/phone) and orderNo is guessable,
  // so it must NOT be public. Authorize by EITHER an unguessable capability token
  // in ?t= (how guests reach their own confirmation) OR a logged-in session that
  // owns this order. Anything else looks like enumeration → notFound().
  const rawT = searchParams?.t
  const t = Array.isArray(rawT) ? rawT[0] : rawT
  let authorized = verifyOrderToken(params.orderNo, t)
  if (!authorized) {
    const session = await getSession('femi9')
    if (session) {
      const owned = await prisma.order.findFirst({
        where: { orderNo: params.orderNo, userId: session.sub },
        select: { id: true },
      })
      authorized = owned !== null
    }
  }
  if (!authorized) notFound()

  // Pre-fill the WhatsApp message with the order number + lines so our team can
  // confirm and share payment details in one reply. WA_NUMBER + rupees per spec.
  const lines = order.items.map((it) => `• ${it.productName} - ${it.variantLabel} x${it.qty} (${rupees(it.lineTotal)})`)
  const waMessage =
    `Hi Femi9! Please confirm my order ${order.orderNo}.\n\n` +
    lines.join('\n') +
    `\n\nTotal: ${rupees(order.total)}`
  const waHref = `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(waMessage)}`

  return (
    <main className="wrap section" style={{ maxWidth: 720 }}>
      {/* Confirmation banner */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 1rem',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(216,162,47,.16)',
            color: 'var(--yellow-deep)',
          }}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="m5 12.5 4.2 4.2L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="eyebrow">Order placed</span>
        <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', margin: '.4em 0 .3em' }}>
          Thank you, {order.customerName}!
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          Your order <strong style={{ color: 'var(--navy)' }}>{order.orderNo}</strong> has been placed.
        </p>
      </div>

      {/* Order card */}
      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--r-card)',
          boxShadow: 'var(--shadow-sm)',
          padding: 'clamp(20px,3vw,32px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.15rem' }}>Order details</h2>
          <span
            style={{
              display: 'inline-block',
              padding: '.3rem .8rem',
              borderRadius: 'var(--r-chip)',
              background: 'var(--butter-soft)',
              border: '1px solid rgba(216,162,47,.35)',
              color: 'var(--navy)',
              fontSize: '.78rem',
              fontWeight: 600,
            }}
          >
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '.9rem' }}>
          {order.items.map((it, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.95rem' }}>{it.productName}</div>
                <div style={{ color: 'var(--muted)', fontSize: '.82rem' }}>
                  {it.variantLabel} · {rupees(it.unitPrice)} × {it.qty}
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: '.9rem', whiteSpace: 'nowrap' }}>{rupees(it.lineTotal)}</div>
            </li>
          ))}
        </ul>

        <div style={{ borderTop: '1px solid var(--line-soft)', margin: '1.2rem 0 1rem', paddingTop: '1rem', display: 'grid', gap: '.5rem' }}>
          <SummaryRow label="Subtotal" value={rupees(order.subtotal)} />
          <SummaryRow label="Shipping" value={order.shipping === 0 ? 'Free' : rupees(order.shipping)} />
        </div>

        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: 700,
            fontSize: '1.15rem',
          }}
        >
          <span>Total</span>
          <span>{rupees(order.total)}</span>
        </div>

        {order.address && (
          <div style={{ marginTop: '1.4rem', color: 'var(--muted)', fontSize: '.85rem', lineHeight: 1.55 }}>
            <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: '.15rem' }}>Shipping to</div>
            {order.address.name}
            <br />
            {order.address.line}, {order.address.city}
            {order.address.state ? `, ${order.address.state}` : ''}
            {order.address.pincode ? ` - ${order.address.pincode}` : ''}
            {order.address.phone ? (
              <>
                <br />
                {order.address.phone}
              </>
            ) : null}
          </div>
        )}
      </section>

      {/* Payment status / support */}
      <div
        style={{
          marginTop: '1.6rem',
          background: 'var(--forest)',
          color: '#fff9ea',
          borderRadius: 'var(--r-card)',
          padding: 'clamp(20px,3vw,28px)',
          textAlign: 'center',
        }}
      >
        <h2 style={{ color: '#fff9ea', fontSize: '1.2rem', marginBottom: '.5rem' }}>
          {order.status === 'paid' ? 'Payment confirmed' : 'Payment still pending'}
        </h2>
        <p style={{ fontSize: '.9rem', opacity: 0.9, marginBottom: '1.2rem', lineHeight: 1.55 }}>
          {order.status === 'paid'
            ? 'Your secure online payment was received. Keep this order number for your records while our team prepares the shipment.'
            : 'No payment has been captured yet. Contact our team with this order number if the payment window closed or you need help completing it.'}
        </p>
        {order.status !== 'paid' ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            {order.status === 'pending' ? (
              <RetryPaymentButton orderNo={order.orderNo} token={t} />
            ) : null}
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              Get payment help
            </a>
          </div>
        ) : null}
      </div>

      <div style={{ textAlign: 'center', marginTop: '1.6rem' }}>
        <Link href="/shop" className="btn btn-ghost">
          Continue shopping
        </Link>
      </div>
    </main>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.92rem' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

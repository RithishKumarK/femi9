'use client'

import { useEffect, useState } from 'react'
import { THARA_TERMS_VERSION } from '@/lib/thara/terms'
import '@/styles/thara.css'

/**
 * /thara — the customer's Thara page, drawn to the "Feminine E-commerce Design
 * System" comp.
 *
 * The page has two jobs and the first one used to be missing entirely: it has
 * to TEACH the programme before it reports on it. So the order is: what it is
 * → the three steps → where you are on them → what you earn, in real rupees →
 * your tools → the questions people actually ask. The explainer is shown to
 * members and non-members alike, because a member who has forgotten how it
 * works needs it just as much as a new one.
 *
 * The comp's shape, section by section: a lavender-wash hero with a gold pill
 * CTA, "How Thara works" as 01/02/03 cards, "What you get" as three icon
 * tiles, the worked example on a navy panel, the discount slabs as a table
 * card, and the questions as an ACCORDION rather than a flat list.
 *
 * Every number printed here comes from /api/thara/summary (`rules`), never from
 * copy typed into this file, so the page cannot teach a slab the checkout no
 * longer applies.
 */

type Status = 'purchase_pending' | 'active' | 'suspended' | 'deactivated'
type VoucherStatus = 'available' | 'claimed' | 'expired' | 'cancelled'

interface Rules {
  minOrderPaise: number
  commissionPct: number
  pointsPct: number
  voucherMultiplier: number
  voucherClaimDays: number
  slabs: { minPaise: number; maxPaise: number | null; pct: number }[]
}

interface Unlock {
  requiredPaise: number
  bestOrderPaise: number
  bestOrderNo: string | null
  paidOrderCount: number
  qualified: boolean
  shortfallPaise: number
}

interface Summary {
  enrolled: true
  rules: Rules
  unlock: Unlock
  membership: {
    status: Status
    referralCode: string
    referralUrl: string
    enrolledAt: string
    activatedAt: string | null
  }
  referrerCode: string | null
  downlineCount: number
  credit: {
    balancePaise: number
    recentRows: { id: string; delta: number; reason: string; sourceOrderId: string | null; balanceAfter: number; createdAt: string }[]
  }
  cycle: {
    id: string
    startDate: string
    endDate: string
    status: 'open' | 'closed'
    currentPoints: number
    estimatedVoucherRupees: number
  }
  vouchers: {
    id: string
    cycleId: string
    points: number
    valuePaise: number
    status: VoucherStatus
    issuedAt: string
    claimDeadline: string
    claimedAt: string | null
    hasAmazonCode: boolean
    amazonCode: string | null
  }[]
}

interface NotEnrolled {
  enrolled: false
  rules?: Rules
  unlock?: Unlock
}

type Response = NotEnrolled | Summary

/** Only used if an old cached response arrives without `rules`. */
const FALLBACK_RULES: Rules = {
  minOrderPaise: 300_000,
  commissionPct: 10,
  pointsPct: 1,
  voucherMultiplier: 3,
  voucherClaimDays: 30,
  slabs: [
    { minPaise: 300_000, maxPaise: 599_999, pct: 10 },
    { minPaise: 600_000, maxPaise: 899_999, pct: 15 },
    { minPaise: 900_000, maxPaise: null, pct: 20 },
  ],
}
const FALLBACK_UNLOCK: Unlock = {
  requiredPaise: 300_000,
  bestOrderPaise: 0,
  bestOrderNo: null,
  paidOrderCount: 0,
  qualified: false,
  shortfallPaise: 300_000,
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const dt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Plain-English name for each membership state. "purchase_pending" is a
 *  database word; nobody should have to read it. */
const STATUS_LABEL: Record<Status, string> = {
  purchase_pending: 'Joined - not unlocked yet',
  active: 'Unlocked - you are earning',
  suspended: 'Paused by our team',
  deactivated: 'You left the programme',
}

// ── Small pieces ────────────────────────────────────────────────────────────

/** Section heading: serif, centred, with the comp's italic tail on the last
 *  word. `tail` is the italic part, `lead` the roman part before it. */
function SectionHead({ lead, tail, sub }: { lead: string; tail: string; sub?: string }) {
  return (
    <div className="t9-sec__head">
      <h2 className="t9-disp t9-h2">
        {lead} <em>{tail}</em>
      </h2>
      {sub && <p className="t9-cap">{sub}</p>}
    </div>
  )
}

function IconTick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  )
}
function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
/** Your own discount — a price tag. */
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12.6 3.4H20a.6.6 0 0 1 .6.6v7.4a1 1 0 0 1-.3.7l-8.3 8.3a1 1 0 0 1-1.4 0l-7.4-7.4a1 1 0 0 1 0-1.4l8.3-8.3a1 1 0 0 1 .7-.3Z" />
      <circle cx="16.6" cy="7.4" r="1.4" />
    </svg>
  )
}
/** Femi9 money — a coin. */
function IconCoin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 8h6M9 11h6M13.5 8c1.6 0 2 1 2 1.5s-.4 1.5-2 1.5H10l4.5 5" />
    </svg>
  )
}
/** Amazon voucher — a gift box. */
function IconGift() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 11h16v9H4v-9ZM3 7.5h18V11H3V7.5ZM12 7.5V20" />
      <path d="M12 7.5S10.5 4 8.5 4a2 2 0 0 0 0 4h3.5Zm0 0S13.5 4 15.5 4a2 2 0 0 1 0 4H12Z" />
    </svg>
  )
}

// ── Explainer sections ──────────────────────────────────────────────────────

/**
 * The three steps, always in the same order. On the member view each one also
 * carries its state, so she can see at a glance which one she is standing on;
 * the join screen shows none, exactly as the comp draws it.
 */
function Steps({
  rules,
  enrolled,
  unlocked,
}: {
  rules: Rules
  enrolled: boolean
  unlocked: boolean
}) {
  const state = (done: boolean, now: boolean) => (done ? 'done' : now ? 'now' : 'later')
  const steps = [
    {
      title: 'Join',
      body: 'Free, one tap. You get your own referral link immediately.',
      cls: state(enrolled, !enrolled),
    },
    {
      title: 'Unlock',
      body: `Place one order of ${rs(rules.minOrderPaise)} or more. That single order switches earning on - it pays full price.`,
      cls: state(unlocked, enrolled && !unlocked),
    },
    {
      title: 'Share & earn',
      body: 'Send your link. Every friend who buys earns you money and points.',
      cls: state(false, unlocked),
    },
  ]
  return (
    <section className="t9-sec">
      <SectionHead lead="How Thara" tail="works" />
      <ol className="t9-grid t9-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`t9-card t9-step t9-step--${s.cls}`}>
            <span className="t9-step__n" aria-hidden="true">{`0${i + 1}`}</span>
            <h3 className="t9-h3">{s.title}</h3>
            <p>{s.body}</p>
            {enrolled && (
              <span className="t9-step__state">
                {s.cls === 'done' ? 'Done' : s.cls === 'now' ? 'You are here' : 'Next'}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="t9-cap t9-sec__foot">
        Orders are not added together - it is one single order of {rs(rules.minOrderPaise)}, not a running total.
      </p>
    </section>
  )
}

/**
 * The unlock meter. This is the answer to "I ordered twice, why is nothing
 * unlocked?" — it shows the BIGGEST SINGLE order, because that is what the rule
 * actually measures, and says so in words.
 */
function UnlockMeter({ rules, unlock }: { rules: Rules; unlock: Unlock }) {
  const pct = Math.min(100, Math.round((unlock.bestOrderPaise / unlock.requiredPaise) * 100))
  return (
    <section className="t9-sec">
      <div className="t9-sec__head t9-sec__head--left">
        <h2 className="t9-disp t9-h2">How close are <em>you?</em></h2>
      </div>
      <div className="t9-card t9-meter">
        <div
          className="t9-meter__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Progress towards unlocking Thara earnings"
        >
          <div className="t9-meter__fill" style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
        <div className="t9-meter__legend">
          <span>{rs(unlock.bestOrderPaise)} - your biggest single order</span>
          <span>{rs(unlock.requiredPaise)} needed</span>
        </div>
        {unlock.paidOrderCount === 0 ? (
          <p>You have not placed an order yet. Your first order of {rs(rules.minOrderPaise)} or more unlocks everything below.</p>
        ) : unlock.qualified ? (
          <p>Your order {unlock.bestOrderNo ? `${unlock.bestOrderNo} ` : ''}of {rs(unlock.bestOrderPaise)} already qualifies. You are unlocked.</p>
        ) : (
          <p>
            You have placed {unlock.paidOrderCount} order{unlock.paidOrderCount === 1 ? '' : 's'}. Your biggest one
            is {rs(unlock.bestOrderPaise)}, so you need <strong>{rs(unlock.shortfallPaise)} more in a single order</strong>.
          </p>
        )}
        <p className="t9-note">
          <strong>Important:</strong> orders are not added together. Two orders of {rs(Math.round(rules.minOrderPaise / 2))} do
          not unlock the programme - one order of {rs(rules.minOrderPaise)} does.
        </p>
      </div>
    </section>
  )
}

/** The three benefits as icon tiles, then the worked example in real rupees. */
function Benefits({ rules }: { rules: Rules }) {
  const topPct = rules.slabs[rules.slabs.length - 1]?.pct ?? 20
  const example = rules.minOrderPaise // a friend's qualifying-sized order
  const credit = Math.floor((example * rules.commissionPct) / 100)
  const points = Math.floor((example * rules.pointsPct) / 100 / 100)
  const voucher = points * rules.voucherMultiplier
  return (
    <section className="t9-sec">
      <SectionHead lead="What you" tail="get" />
      <div className="t9-grid">
        <div className="t9-card t9-benefit">
          <span className="t9-tile" aria-hidden="true"><IconTag /></span>
          <h3 className="t9-h3">Your own discount</h3>
          <p>Up to {topPct}% off your own orders once you are unlocked.</p>
        </div>
        <div className="t9-card t9-benefit">
          <span className="t9-tile" aria-hidden="true"><IconCoin /></span>
          <h3 className="t9-h3">Femi9 money</h3>
          <p>{rules.commissionPct}% of every friend&apos;s order as store credit, off your next order.</p>
        </div>
        <div className="t9-card t9-benefit">
          <span className="t9-tile" aria-hidden="true"><IconGift /></span>
          <h3 className="t9-h3">Amazon voucher</h3>
          <p>Collect points that become a real Amazon gift code every quarter.</p>
        </div>
      </div>

      <div className="t9-example">
        <p className="t9-ey">A worked example</p>
        <ol className="t9-example__rows">
          <li><span>Your friend spends</span><strong>{rs(example)}</strong></li>
          <li><span>You get Femi9 money</span><strong className="t9-gold">{rs(credit)}</strong></li>
          <li><span>You also collect points</span><strong>{points} points</strong></li>
          <li><span>Those points become a voucher</span><strong className="t9-gold">₹{voucher} Amazon</strong></li>
        </ol>
        <p className="t9-example__foot">That is one friend, one order. Ten friends doing the same is ten times as much.</p>
      </div>
    </section>
  )
}

/** The personal-discount slabs as the comp's two-column table card. */
function Slabs({ rules }: { rules: Rules }) {
  const floorPaise = rules.slabs[0]?.minPaise ?? rules.minOrderPaise
  return (
    <section className="t9-sec">
      <SectionHead lead="Your own" tail="discount" sub="Based on each order's subtotal, once unlocked." />
      <div className="t9-slabs">
        <div className="t9-slabs__head">
          <span>Order subtotal</span>
          <span>Discount</span>
        </div>
        <div className="t9-slabs__row t9-slabs__row--none">
          <span className="t9-slabs__range">Under {rs(floorPaise)}</span>
          <span className="t9-slabs__pct" aria-label="no discount">-</span>
        </div>
        {rules.slabs.map((s) => (
          <div className="t9-slabs__row" key={s.pct}>
            <span className="t9-slabs__range">
              {s.maxPaise === null ? `${rs(s.minPaise)} and above` : `${rs(s.minPaise)} - ${rs(s.maxPaise)}`}
            </span>
            <span className="t9-slabs__pct">{s.pct}%</span>
          </div>
        ))}
      </div>
      <p className="t9-cap t9-sec__foot">
        At checkout you get whichever saves you more - the Thara discount or a promo code, never both.
      </p>
    </section>
  )
}

/**
 * The six questions, as an accordion. Native <details>/<summary>: keyboard and
 * screen-reader behaviour comes free, find-in-page still reaches a closed
 * answer, and nothing depends on JavaScript having loaded.
 */
function Faq({ rules }: { rules: Rules }) {
  const items = [
    {
      q: 'Do my friends have to join Thara too?',
      a: 'No. They just shop with your link. Only you need to be a member to earn.',
    },
    {
      q: 'Is the money real?',
      a: `Femi9 money comes off your next order; it cannot go to a bank or UPI. The Amazon voucher is a real gift code.`,
    },
    {
      q: 'I placed two orders. Why am I still locked?',
      a: `Orders are not added together. You need one single order of ${rs(rules.minOrderPaise)} or more.`,
    },
    {
      q: 'Does my first big order get the discount?',
      a: 'No. That order is what unlocks you; the discount starts on the order after it.',
    },
    {
      q: 'When does my Amazon voucher arrive?',
      a: `At the end of each three-month cycle; then you have ${rules.voucherClaimDays} days to claim it.`,
    },
    {
      q: 'What if my friend returns their order?',
      a: 'The money earned on it is taken back.',
    },
  ]
  return (
    <section className="t9-sec">
      <SectionHead lead="Questions people" tail="ask" />
      <div className="t9-faq">
        {items.map((it) => (
          <details className="t9-faq__item" key={it.q}>
            <summary className="t9-faq__q">
              {it.q}
              <span className="t9-faq__chev" aria-hidden="true"><IconChevron /></span>
            </summary>
            <p className="t9-faq__a">{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TharaPage() {
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState('')
  const [inviteMsg, setInviteMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function copyReferral(url: string) {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is permission-gated and absent over plain HTTP. The URL
      // is printed below the button either way, so say plainly that the copy did
      // not happen rather than leaving the label stuck on "Copy link".
      setCopyError('Copying is blocked in this browser - select the link below instead.')
    }
  }

  /**
   * Leave the programme. Confirmed by the inline two-button step in the card.
   * Deactivation is terminal — enrollUser() throws TharaDeactivatedError for a
   * deactivated membership — so the copy has to say so before the click.
   */
  async function optOut() {
    setLeaving(true)
    setLeaveError(null)
    try {
      const res = await fetch('/api/thara/opt-out', { method: 'POST' })
      if (res.status === 401) {
        window.location.href = '/login?next=/thara'
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setLeaveError(body.error ?? 'We could not update your membership. Please try again.')
        return
      }
      setConfirmLeave(false)
      await load()
    } catch {
      setLeaveError('We could not reach the server. Please check your connection.')
    } finally {
      setLeaving(false)
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/thara/summary', { cache: 'no-store' })
      if (res.status === 404) {
        setError('The Thara Model isn\'t switched on for this store yet. Check back soon.')
        return
      }
      if (res.status === 401) {
        window.location.href = '/login?next=/thara'
        return
      }
      const body = await res.json()
      setData(body)
    } catch {
      setError('Could not load your Thara page. Please check your connection and try again.')
    }
  }
  useEffect(() => { void load() }, [])

  /**
   * Enrol. The route rejects a stale terms version and refuses a previously
   * deactivated account, both as a 400 carrying the reason — this used to be
   * `if (res.ok) await load()` with no else, so those two real refusals looked
   * exactly like a button that did nothing.
   */
  async function enrol() {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/thara/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ termsVersion: THARA_TERMS_VERSION }),
      })
      if (res.status === 401) {
        window.location.href = '/login?next=/thara'
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error ?? 'We could not enrol you just now. Please try again.')
        return
      }
      await load()
    } catch {
      setActionError('We could not reach the server. Please check your connection.')
    } finally {
      setBusy(false)
    }
  }

  async function sendInvite() {
    if (!invite.trim()) return
    setBusy(true)
    setInviteMsg(null)
    try {
      const res = await fetch('/api/thara/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: invite.trim() }),
      })
      // A session that lapsed while this page sat open reads as a generic
      // failure otherwise, which invites the member to retype and retry forever.
      if (res.status === 401) {
        window.location.href = '/login?next=/thara'
        return
      }
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setInvite('')
        setInviteMsg(body.mock ? 'Invite queued (mock mode - check dev logs).' : 'Invite sent.')
      } else {
        setInviteMsg(body.error ?? 'Could not send that invite.')
      }
    } catch {
      setInviteMsg('We could not reach the server. Please check your connection.')
    } finally {
      setBusy(false)
    }
  }

  /** Claim a voucher. A voucher past its deadline 400s with the reason. */
  async function claim(id: string) {
    setClaiming(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/thara/vouchers/${id}/claim`, { method: 'POST' })
      if (res.status === 401) {
        window.location.href = '/login?next=/thara'
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error ?? 'We could not claim that voucher. Please try again.')
        return
      }
      await load()
    } catch {
      setActionError('We could not reach the server. Please check your connection.')
    } finally {
      setClaiming(null)
    }
  }

  if (error) {
    return (
      <main className="thara">
        <div className="t9-empty"><p>{error}</p></div>
      </main>
    )
  }
  if (!data) {
    return (
      <main className="thara">
        <div className="t9-empty"><p>Loading your Thara page…</p></div>
      </main>
    )
  }

  const rules = data.rules ?? FALLBACK_RULES
  const unlock = data.unlock ?? FALLBACK_UNLOCK

  // ── Not a member yet: the comp's join screen ──────────────────────────────
  if (!data.enrolled) {
    return (
      <main className="thara">
        <section className="t9-hero">
          <p className="t9-ey">Femi9 Thara</p>
          <h1 className="t9-disp t9-hero__title">
            Shop. Share. <em>Earn.</em>
          </h1>
          <p className="t9-lede">
            Join free, place one qualifying order, and start earning on every friend who shops with your link - plus a
            standing discount on your own orders and a quarterly Amazon voucher.
          </p>
          {unlock.qualified && (
            <p className="t9-notice">
              <span className="t9-notice__tick" aria-hidden="true"><IconTick /></span>
              <span>
                <strong>Good news - your {rs(unlock.bestOrderPaise)} order already meets the {rs(rules.minOrderPaise)} rule.</strong>{' '}
                Join now and you are unlocked immediately.
              </span>
            </p>
          )}
          <button className="t9-btn t9-btn--gold t9-btn--lg" disabled={busy} onClick={() => void enrol()}>
            {busy ? 'Joining…' : 'Join Thara - free'}
          </button>
          {actionError && <p className="t9-error" role="alert">{actionError}</p>}
        </section>

        <Steps rules={rules} enrolled={false} unlocked={false} />
        <Benefits rules={rules} />
        <Slabs rules={rules} />
        <Faq rules={rules} />

        <section className="t9-close">
          <h2 className="t9-disp t9-h2">Ready when you <em>are</em></h2>
          <p className="t9-lede">Joining is free and takes one tap. Your link is ready the moment you&apos;re in.</p>
          <button className="t9-btn t9-btn--gold t9-btn--lg" disabled={busy} onClick={() => void enrol()}>
            {busy ? 'Joining…' : 'Join Thara - free'}
          </button>
          {actionError && <p className="t9-error" role="alert">{actionError}</p>}
        </section>
      </main>
    )
  }

  // ── Member ────────────────────────────────────────────────────────────────
  const s = data
  const st = s.membership.status
  const unlocked = st === 'active'
  return (
    <main className="thara">
      <section className="t9-hero t9-hero--member">
        <div className="t9-hero__row">
          <div className="t9-hero__copy">
            <p className="t9-ey">Femi9 Thara</p>
            <h1 className="t9-disp t9-hero__title">Your <em>Thara</em></h1>
            <p className={`t9-status t9-status--${st}`}>{STATUS_LABEL[st]}</p>
            <p className="t9-lede">
              {unlocked
                ? 'Your link is live. Every friend who shops with it earns you Femi9 money and points.'
                : st === 'purchase_pending'
                  ? `You are in. One order of ${rs(rules.minOrderPaise)} or more switches your earning on.`
                  : st === 'suspended'
                    ? 'Earning is paused while our team reviews your account. Anything you already earned is safe.'
                    : 'You have left the programme. Credit you already earned stays on your account.'}
            </p>
          </div>
          <div className="t9-metric">
            <div className="t9-metric__label">Femi9 money</div>
            <div className="t9-metric__value">{rs(s.credit.balancePaise)}</div>
            <div className="t9-cap">comes off your next order</div>
          </div>
        </div>
      </section>

      <Steps rules={rules} enrolled unlocked={unlocked} />

      {!unlocked && st !== 'deactivated' && <UnlockMeter rules={rules} unlock={unlock} />}

      <section className="t9-sec">
        <div className="t9-sec__head t9-sec__head--left">
          <h2 className="t9-disp t9-h2">Your link - this is what you <em>share</em></h2>
        </div>
        <div className="t9-card">
          <div className="t9-code-row">
            <code>{s.membership.referralCode}</code>
            <button className="t9-btn t9-btn--gold t9-btn--sm" onClick={() => void copyReferral(s.membership.referralUrl)}>
              {copied ? 'Copied ✓' : 'Copy my link'}
            </button>
          </div>
          {copyError && <p className="t9-error" role="alert">{copyError}</p>}
          <p className="t9-url" style={{ marginTop: 12 }}>{s.membership.referralUrl}</p>
          <p style={{ marginTop: 12 }}>
            Send it on WhatsApp, put it in your bio, message it to a friend - anywhere. When someone opens it and later
            buys, we know they came from you.
          </p>
          <p className="t9-cap" style={{ marginTop: 8 }}>
            {s.downlineCount === 0
              ? 'No friends have signed up with your link yet.'
              : `${s.downlineCount} ${s.downlineCount === 1 ? 'friend has' : 'friends have'} signed up with your link.`}
            {' '}
            {unlocked ? 'You are earning on their orders.' : `Earning starts once you place your ${rs(rules.minOrderPaise)} order.`}
          </p>

          <div className="t9-field-row" style={{ marginTop: 20 }}>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="friend@example.com"
              aria-label="Friend's email address"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              disabled={busy}
            />
            <button className="t9-btn t9-btn--ghost t9-btn--sm" disabled={busy || !invite.trim()} onClick={() => void sendInvite()}>
              {busy ? 'Sending…' : 'Email the link'}
            </button>
          </div>
          {inviteMsg && <p className="t9-cap" style={{ marginTop: 8 }}>{inviteMsg}</p>}
        </div>
      </section>

      <Benefits rules={rules} />
      <Slabs rules={rules} />

      <section className="t9-sec">
        <div className="t9-sec__head t9-sec__head--left">
          <h2 className="t9-disp t9-h2">Your points this <em>cycle</em></h2>
          <p className="t9-cap">
            Points from friends&apos; orders between {dt(s.cycle.startDate)} and {dt(s.cycle.endDate)}. At the end of the
            cycle they turn into an Amazon voucher.
          </p>
        </div>
        <div className="t9-card">
          <div className="t9-row">
            <div className="t9-metric">
              <div className="t9-metric__label">Points so far</div>
              <div className="t9-metric__value">{s.cycle.currentPoints}</div>
            </div>
            <div className="t9-metric">
              <div className="t9-metric__label">Voucher if the cycle ended today</div>
              <div className="t9-metric__value">₹{s.cycle.estimatedVoucherRupees}</div>
            </div>
          </div>
          {s.cycle.currentPoints === 0 && (
            <p className="t9-cap" style={{ marginTop: 14 }}>
              No points yet. Points arrive when a friend who used your link places an order.
            </p>
          )}
        </div>
      </section>

      {s.vouchers.length > 0 && (
        <section className="t9-sec">
          <div className="t9-sec__head t9-sec__head--left">
            <h2 className="t9-disp t9-h2">Your Amazon <em>vouchers</em></h2>
            <p className="t9-cap">Claim within {rules.voucherClaimDays} days of the issue date or the voucher expires.</p>
          </div>
          <div className="t9-card">
            {/* The five uppercase single-word headers cannot wrap, so this table
                min-contents wider than a 360px phone allows. html/body are
                `overflow-x: clip`, so without the scroller the Status pill and
                the whole Action column are unreachable. */}
            <div className="t9-scroll">
              <table className="t9-table">
                <thead><tr><th>Issued</th><th>Points</th><th>Value</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {s.vouchers.map((v) => (
                    <tr key={v.id}>
                      <td>{dt(v.issuedAt)}</td>
                      <td>{v.points}</td>
                      <td>{rs(v.valuePaise)}</td>
                      <td><span className={`t9-pill t9-pill--${v.status}`}>{v.status}</span></td>
                      <td>
                        {v.status === 'available' && v.hasAmazonCode && (
                          <button className="t9-btn t9-btn--ghost t9-btn--sm" disabled={claiming === v.id} onClick={() => void claim(v.id)}>
                            {claiming === v.id ? 'Claiming…' : 'Claim'}
                          </button>
                        )}
                        {v.status === 'claimed' && v.amazonCode && <code>{v.amazonCode}</code>}
                        {v.status === 'available' && !v.hasAmazonCode && <span className="t9-cap">Awaiting code</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {actionError && <p className="t9-error" role="alert">{actionError}</p>}
          </div>
        </section>
      )}

      {s.credit.recentRows.length > 0 && (
        <section className="t9-sec">
          <div className="t9-sec__head t9-sec__head--left">
            <h2 className="t9-disp t9-h2">Where your Femi9 money <em>came from</em></h2>
          </div>
          <div className="t9-card">
            <div className="t9-scroll">
              <table className="t9-table">
                <thead><tr><th>Date</th><th>Reason</th><th>Change</th><th>Balance</th></tr></thead>
                <tbody>
                  {s.credit.recentRows.map((r) => (
                    <tr key={r.id}>
                      <td>{dt(r.createdAt)}</td>
                      <td>{r.reason.replace(/-/g, ' ')}</td>
                      <td className={r.delta >= 0 ? 't9-credit' : 't9-debit'}>
                        {r.delta >= 0 ? '+' : ''}{rs(r.delta)}
                      </td>
                      <td>{rs(r.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <Faq rules={rules} />

      {/* Leaving the programme. /api/thara/opt-out shipped with no control
          anywhere in the product, so an enrolled member had no way out. The
          confirm step is two buttons in the card — never a blocking browser
          dialog, and never gold. A membership already deactivated has nothing
          left to leave, so the whole block drops out rather than offering a
          no-op. */}
      {st !== 'deactivated' && (
        <section className="t9-sec">
          <div className="t9-sec__head t9-sec__head--left">
            <h2 className="t9-disp t9-h2">Leaving the <em>programme</em></h2>
          </div>
          <div className="t9-card">
            <p className="t9-cap">
              Opting out stops new referral earnings and cannot be undone - rejoining later is not
              possible. Credit you have already earned stays on your account, and any issued voucher
              remains claimable until its deadline.
            </p>
            {leaveError && <p className="t9-error" role="alert">{leaveError}</p>}
            {confirmLeave ? (
              <div className="t9-field-row" style={{ marginTop: 16 }}>
                <button className="t9-btn t9-btn--ghost t9-btn--sm" disabled={leaving} onClick={() => void optOut()}>
                  {leaving ? 'Leaving…' : 'Yes, leave Thara for good'}
                </button>
                <button className="t9-btn t9-btn--ghost t9-btn--sm" disabled={leaving} onClick={() => setConfirmLeave(false)}>
                  Stay in
                </button>
              </div>
            ) : (
              <button className="t9-btn t9-btn--ghost t9-btn--sm" style={{ marginTop: 16 }} onClick={() => setConfirmLeave(true)}>
                Leave the Thara programme
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  )
}

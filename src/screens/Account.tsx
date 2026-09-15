'use client'

/**
 * /account — the signed-in customer's home.
 *
 * This screen used to render <Shell variant="user">, which was the ADMIN console's
 * chrome: a left sidebar carrying an "Admin dashboard" link, two permanently
 * disabled topbar buttons, and the admin CSS system (panel / dash-grid / col-* /
 * dtable / badge). It edited the profile with prompt() and reported failures with
 * alert(). All of that is gone. The page now renders inside <MemberLayout> and is
 * built from the `.m-*` kit in member.css plus the `.acct-*` layout in account.css.
 *
 * It stays a pure client view: app/account/page.tsx resolves the real user on the
 * server and hands everything down as serializable props, so there is exactly one
 * identity resolver and one fallback string in the whole product.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link } from '@/lib/router-compat'
import { MemberLayout } from '@/components/MemberLayout'
import { Rewards } from '@/components/Rewards'
import { OptImg } from '@/components/OptImg'
import { useMediaGate } from '@/components/useMediaGate'
import { AreaChart } from '../charts/AreaChart'
import { fmtRs, fmtRsK } from '../charts/util'
import { useCart } from '@/store/cart'
import {
  IAlert,
  IBox,
  ICheck,
  IChevron,
  IGift,
  IPencil,
  IPin,
  IRupee,
  ISparkles,
  ITrash,
  ITrend,
} from '@/components/AppIcons'
// The dialog primitive and the two write sheets now live in one place, shared
// with /dashboard — see the note at the top of that file.
import { AddressSheet, ProfileSheet, readFailure } from '@/components/member/sheets'
import { authorizeMandate, type MandateAuthorization } from '@/lib/mandate'
import type {
  AccountAddress,
  AccountCoupon,
  AccountOrder,
  AccountSubscription,
  AccountUser,
  ActivityItem,
  EarnRates,
  SpendTrend,
  SubStatus,
} from '@femi9/core/services/account'
import type { RewardOptionView } from '@femi9/core/services/rewards'

export interface AccountProps {
  user: AccountUser
  pointsBalance: number
  orders: AccountOrder[]
  addresses: AccountAddress[]
  subscriptions: AccountSubscription[]
  coupons: AccountCoupon[]
  earnRates: EarnRates
  spendTrend: SpendTrend
  activity: ActivityItem[]
  rewardOptions: RewardOptionView[]
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Order status → the four member status tones. `pending` is the most common
 *  status a customer ever sees, so it must not fall through to bare text. */
const ORDER_TONE: Record<AccountOrder['statusKey'], 'active' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  processing: 'warning',
  paid: 'active',
  shipped: 'active',
  delivered: 'success',
  cancelled: 'danger',
  refunded: 'danger',
}

const SUB_TONE: Record<SubStatus, 'active' | 'warning' | 'danger'> = {
  pending_mandate: 'warning',
  active: 'active',
  paused: 'warning',
  // A halted plan is not merely paused: Razorpay has stopped trying, and it
  // will not restart on its own. It reads as danger because only she can fix it.
  halted: 'danger',
  cancelled: 'danger',
}
const SUB_LABEL: Record<SubStatus, string> = {
  pending_mandate: 'Auto-pay not set up',
  active: 'Active',
  paused: 'Paused',
  halted: 'Payment failed',
  cancelled: 'Cancelled',
}

/** Statuses that never represent money the customer actually kept spending. */
const NON_SPEND: AccountOrder['statusKey'][] = ['cancelled', 'refunded']


// ── Screen ───────────────────────────────────────────────────────────────────

type TabKey = 'orders' | 'subscriptions' | 'addresses' | 'profile'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'orders', label: 'Orders' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'profile', label: 'Profile' },
]

export function Account({
  user,
  pointsBalance,
  orders,
  addresses,
  subscriptions,
  coupons,
  earnRates,
  spendTrend,
  activity,
  rewardOptions,
}: AccountProps) {
  const router = useRouter()
  const { notify } = useCart()

  const [tab, setTab] = useState<TabKey>('orders')
  const [profileSheet, setProfileSheet] = useState<{ focus?: 'name' | 'email' | 'phone' } | null>(null)
  const [addressSheet, setAddressSheet] = useState<{ address: AccountAddress | null } | null>(null)
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({})
  /** Matches member.css's `.m-band__art` breakpoint — below it the decoration is
   *  not painted, so it must not be fetched either. */
  const showBandArt = useMediaGate('(min-width: 621px)')

  /**
   * One mutation helper for every fire-and-refresh control on this page.
   * A failure becomes a toast (the whole request failed) — never an alert(),
   * and never a silent revert.
   */
  const mutate = useCallback(
    async (url: string, init: RequestInit): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          ...init,
          headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        })
        if (!res.ok) {
          notify((await readFailure(res)).message)
          return false
        }
        router.refresh()
        return true
      } catch {
        notify('We could not reach the server. Check your connection and try again.')
        return false
      }
    },
    [notify, router],
  )

  // Lifetime spend excludes cancelled/refunded orders — money that came back is
  // not money spent, and claiming otherwise on a summary tile is a small lie.
  const lifetimeSpend = useMemo(
    () => orders.filter((o) => !NON_SPEND.includes(o.statusKey)).reduce((sum, o) => sum + o.total, 0),
    [orders],
  )

  // The cheapest reward still out of reach drives the points tile's sub-line.
  const nextReward = useMemo(
    () => [...rewardOptions].sort((a, b) => a.costPoints - b.costPoints).find((r) => r.costPoints > pointsBalance) ?? null,
    [rewardOptions, pointsBalance],
  )
  const pointsNote = nextReward
    ? `${(nextReward.costPoints - pointsBalance).toLocaleString('en-IN')} points to ${nextReward.title}`
    : rewardOptions.length > 0
      ? 'Every reward below is within reach'
      : 'Earn points on every order'

  const activeSubs = subscriptions.filter((s) => s.status !== 'cancelled').length

  const counts: Record<TabKey, number | null> = {
    orders: orders.length,
    subscriptions: activeSubs,
    addresses: addresses.length,
    profile: null,
  }

  /** Roving-tabindex arrow navigation, as a real tablist owes its keyboard users. */
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.key === tab)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    const key = TABS[next].key
    setTab(key)
    tabRefs.current[key]?.focus()
  }

  return (
    <MemberLayout
      identity={{
        displayName: user.displayName,
        initials: user.initials,
        tier: user.tier,
        image: user.image,
      }}
      active="overview"
      title={user.greeting}
      lead="Your orders, Bloom points, refills and delivery details - all in one place."
      actions={
        <button type="button" className="btn btn-ghost" onClick={() => setProfileSheet({})}>
          <IPencil aria-hidden="true" />
          <span>Edit profile</span>
        </button>
      }
    >
      {/* ── At a glance ─────────────────────────────────────────────────── */}
      <section className="m-figures" aria-label="Account summary">
        <div className="m-figure">
          <div className="m-figure__top">
            <span className="m-figure__label">Bloom points</span>
            <span className="m-figure__icon" aria-hidden="true"><ISparkles /></span>
          </div>
          <span className="m-figure__value">{pointsBalance.toLocaleString('en-IN')}</span>
          <span className="m-figure__note">{pointsNote}</span>
        </div>

        <div className="m-figure">
          <div className="m-figure__top">
            <span className="m-figure__label">Orders placed</span>
            <span className="m-figure__icon" aria-hidden="true"><IBox /></span>
          </div>
          <span className="m-figure__value">{orders.length}</span>
          <span className="m-figure__note">
            {orders.length > 0 ? `Most recent ${orders[0].date}` : 'Your first order is waiting'}
          </span>
        </div>

        <div className="m-figure">
          <div className="m-figure__top">
            <span className="m-figure__label">Lifetime spend</span>
            <span className="m-figure__icon" aria-hidden="true"><IRupee /></span>
          </div>
          <span className="m-figure__value">{fmtRs(lifetimeSpend)}</span>
          <span className="m-figure__note">Member since {user.since}</span>
        </div>
      </section>

      {/* ── Records: orders / subscriptions / addresses / profile ────────── */}
      <section className="m-card m-card--roomy acct-record" aria-label="Your records">
        <div className="m-tabs acct-tabs" role="tablist" aria-label="Account records" onKeyDown={onTabKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`acct-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`acct-panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              className="m-tab"
              onClick={() => setTab(t.key)}
              ref={(el) => {
                tabRefs.current[t.key] = el
              }}
            >
              {t.label}
              {counts[t.key] !== null && <span className="acct-tab__count m-num">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        <div
          className="acct-panel"
          role="tabpanel"
          id={`acct-panel-${tab}`}
          aria-labelledby={`acct-tab-${tab}`}
          tabIndex={0}
        >
          {tab === 'orders' && <OrdersPanel orders={orders} />}
          {tab === 'subscriptions' && <SubscriptionsPanel subscriptions={subscriptions} notify={notify} />}
          {tab === 'addresses' && (
            <AddressesPanel
              addresses={addresses}
              mutate={mutate}
              onAdd={() => setAddressSheet({ address: null })}
              onEdit={(address) => setAddressSheet({ address })}
            />
          )}
          {tab === 'profile' && (
            <ProfilePanel
              user={user}
              notify={notify}
              onEdit={(focus) => setProfileSheet({ focus })}
            />
          )}
        </div>
      </section>

      {/* ── Spend ────────────────────────────────────────────────────────── */}
      <section className="m-card acct-spend" aria-label="Your spend">
        <div className="m-card__head">
          <div>
            <h2 className="m-h3">Your spend</h2>
            <p>Last six months</p>
          </div>
        </div>
        {spendTrend.hasData ? (
          <div className="acct-spend__chart">
            <AreaChart
              labels={spendTrend.labels}
              // --forest-2 as a literal: the chart takes a colour string and
              // cannot read a CSS custom property.
              series={[{ name: 'Spend', color: '#563184', points: spendTrend.values }]}
              height={210}
              yFormat={fmtRs}
              // The axis has ~50px per label: "Rs.12,000" is wider than that and
              // painted off the card at 360px. The tooltip keeps the exact rupee
              // figure, which is the only place it appears at all.
              yAxisFormat={fmtRsK}
            />
          </div>
        ) : (
          <div className="m-empty">
            <span className="m-empty__art" aria-hidden="true"><ITrend /></span>
            <h3 className="m-h3">Nothing to chart yet</h3>
            <p>Your spending will chart here after your first order.</p>
            <Link className="btn btn-ghost" to="/shop">Browse the shop</Link>
          </div>
        )}
      </section>

      {/* ── Rewards (the /account#rewards target in the member sub-nav) ──── */}
      <section id="rewards" className="acct-anchor" aria-label="Femi9 Rewards">
        <Rewards
          pointsBalance={pointsBalance}
          rewardOptions={rewardOptions}
          activity={activity}
          coupons={coupons}
          earnRates={earnRates}
        />
      </section>

      {/* ── Closing band — the one gold CTA on the page ──────────────────── */}
      <section className="m-band acct-band">
        <span className="eyebrow">Femi9 essentials</span>
        <h2 className="m-h2">Stocked up for your next cycle?</h2>
        <p>
          Organic cotton, a breathable top sheet, and a refill plan you can pause, skip or cancel
          whenever your month changes shape.
        </p>
        <div className="m-band__actions">
          <Link className="btn btn-primary" to="/shop">Shop the range</Link>
          <Link className="btn btn-on-forest" to="/dashboard">Track your cycle</Link>
        </div>
        {/* Gated, not CSS-hidden: the source is 1.7 MB at 1346px for a ~300px
            slot, and it only ever renders above 620px. OptImg serves the ladder
            to the tablets that do show it. */}
        {showBandArt && (
          <OptImg className="m-band__art" base="figma-home/products-imgFrame206" sizes="300px" alt="" />
        )}
      </section>

      {profileSheet && (
        <ProfileSheet
          user={user}
          focus={profileSheet.focus}
          notify={notify}
          onClose={() => setProfileSheet(null)}
        />
      )}
      {addressSheet && (
        <AddressSheet
          address={addressSheet.address}
          defaultName={user.name ?? ''}
          defaultPhone={user.phone ?? ''}
          notify={notify}
          onClose={() => setAddressSheet(null)}
        />
      )}
    </MemberLayout>
  )
}

// ── Orders ───────────────────────────────────────────────────────────────────

function OrdersPanel({ orders }: { orders: AccountOrder[] }) {
  const { add, openCart } = useCart()
  const [reordering, setReordering] = useState<string | null>(null)

  async function buyAgain(order: AccountOrder) {
    const lines = order.items.filter((i) => i.variantId)
    if (lines.length === 0 || reordering) return
    setReordering(order.id)
    try {
      // Sequential on purpose: the cart API returns the whole cart each time and
      // parallel writes would race each other's snapshot.
      for (const line of lines) await add(line.variantId, line.qty)
      openCart()
    } finally {
      setReordering(null)
    }
  }

  if (orders.length === 0) {
    return (
      <div className="m-empty">
        <OptImg className="m-empty__photo" base="img/prod-330-double" sizes="132px" alt="" />
        <h3 className="m-h3">No orders yet</h3>
        <p>Every Femi9 order lands here with its items, its total and where it has reached.</p>
        <Link className="btn btn-ghost" to="/shop">Shop the range</Link>
      </div>
    )
  }

  return (
    <div className="m-list acct-orders">
      <div className="m-list__head">
        <span aria-hidden="true" />
        <span>Order</span>
        <span>Total</span>
      </div>
      {orders.map((order) => {
        const canReorder = order.items.some((i) => i.variantId)
        const summary = order.items.map((i) => `${i.name} ×${i.qty}`).join(', ')
        return (
          <div className="m-row acct-order" key={order.id}>
            <span className="m-row__media" aria-hidden="true"><IBox /></span>
            <div className="m-row__main">
              <Link className="m-row__title acct-order__link" to={order.href}>
                {order.id}
              </Link>
              <p className="m-row__meta">
                <span className="m-num">{order.date}</span>
                {summary && <> · {summary}</>}
              </p>
              {canReorder && (
                <div className="acct-order__actions">
                  <button
                    type="button"
                    className="m-linkbtn"
                    onClick={() => void buyAgain(order)}
                    disabled={reordering !== null}
                  >
                    {reordering === order.id ? 'Adding…' : 'Buy again'}
                  </button>
                </div>
              )}
            </div>
            <div className="m-row__end acct-order__end">
              <span className="m-row__amount m-num">{fmtRs(order.total)}</span>
              <span className={`m-status m-status--${ORDER_TONE[order.statusKey]}`}>{order.status}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Subscriptions ────────────────────────────────────────────────────────────

type SubAction = 'pause' | 'resume' | 'skip' | 'cancel'

/** The fields a PATCH can move. Held per id while the request settles. */
interface SubPatch {
  status: SubStatus
  nextDelivery: string
  saved: number
}

function SubscriptionsPanel({
  subscriptions,
  notify,
}: {
  subscriptions: AccountSubscription[]
  notify: (msg: string) => void
}) {
  const router = useRouter()
  // Optimistic view, held ONLY between the PATCH response and the server
  // re-render. A new `subscriptions` array means /account re-rendered against
  // fresh DB rows, so the local copy is dropped and server truth wins — this is
  // what the old `useState('active')` seeding got wrong.
  const [patches, setPatches] = useState<Record<string, SubPatch>>({})
  useEffect(() => {
    setPatches({})
  }, [subscriptions])

  if (subscriptions.length === 0) {
    return (
      <div className="m-empty">
        <span className="m-empty__art" aria-hidden="true"><IGift /></span>
        <h3 className="m-h3">No refill plan yet</h3>
        <p>Subscribe from any product page to have your pads arrive before you need them, and save on every repeat delivery.</p>
        <Link className="btn btn-ghost" to="/shop">Browse the shop</Link>
      </div>
    )
  }

  return (
    <div className="acct-cards">
      {subscriptions.map((sub) => (
        <SubscriptionCard
          key={sub.id}
          sub={{ ...sub, ...(patches[sub.id] ?? {}) }}
          notify={notify}
          onApplied={(patch) => {
            setPatches((prev) => ({ ...prev, [sub.id]: patch }))
            router.refresh()
          }}
        />
      ))}
    </div>
  )
}

function SubscriptionCard({
  sub,
  notify,
  onApplied,
}: {
  sub: AccountSubscription
  notify: (msg: string) => void
  onApplied: (patch: SubPatch) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<SubAction | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Finish a mandate she started and abandoned.
   *
   * It re-fetches the SAME authorization rather than creating a new plan: a
   * second POST to /api/subscriptions would leave her with two subscriptions
   * and, once both were authorised, two debits a cycle for one box.
   */
  async function finishAuthorization() {
    if (authorizing) return
    setAuthorizing(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${sub.id}/authorize`)
      if (!res.ok) {
        setError((await readFailure(res)).message)
        return
      }
      const { authorization } = (await res.json()) as { authorization: MandateAuthorization }
      const outcome = await authorizeMandate(authorization, { description: sub.product })
      if (outcome.ok) {
        notify('Auto-pay is set up')
        router.refresh()
        return
      }
      if (!outcome.dismissed) setError(outcome.message)
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setAuthorizing(false)
    }
  }

  async function run(action: SubAction) {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${sub.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        setError((await readFailure(res)).message)
        return
      }
      const data = (await res.json().catch(() => null)) as { subscription?: SubPatch } | null
      if (data?.subscription) onApplied(data.subscription)
      setConfirming(false)
      notify(
        action === 'pause'
          ? 'Subscription paused'
          : action === 'resume'
            ? 'Subscription resumed'
            : action === 'skip'
              ? 'Next delivery skipped'
              : 'Subscription cancelled',
      )
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const cancelled = sub.status === 'cancelled'

  return (
    <article className="m-card acct-sub">
      <div className="m-card__head">
        <div>
          <h3 className="m-h3">{sub.product}</h3>
          <p>
            {sub.qty} {sub.qty === 1 ? 'pack' : 'packs'} · {sub.frequency}
          </p>
        </div>
        <span className={`m-status m-status--${SUB_TONE[sub.status]}`}>{SUB_LABEL[sub.status]}</span>
      </div>

      {!cancelled && (
        <div className="m-kv">
          <div className="m-kv__row">
            <span className="m-kv__k">Next delivery</span>
            <span className="m-kv__v m-num">{sub.nextDelivery}</span>
          </div>
          {sub.chargeAmount != null && (
            <div className="m-kv__row">
              <span className="m-kv__k">Auto-pay</span>
              <span className="m-kv__v m-num">{fmtRs(sub.chargeAmount)} each delivery</span>
            </div>
          )}
          <div className="m-kv__row">
            <span className="m-kv__k">Saved so far</span>
            <span className="m-kv__v m-num">{fmtRs(sub.saved)}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="m-field__error" role="alert">
          <IAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {cancelled ? (
        <div className="m-card__foot">
          <p className="m-cap">This plan is cancelled. You can start a new one from any product page.</p>
          <Link className="m-linkbtn" to="/shop">
            <span>Subscribe again</span>
            <IChevron aria-hidden="true" />
          </Link>
        </div>
      ) : confirming ? (
        <div className="m-confirm" role="group" aria-label="Confirm cancellation">
          <span>Cancel this subscription?</span>
          <span className="m-confirm__actions">
            <button type="button" className="m-linkbtn" onClick={() => void run('cancel')} disabled={busy !== null}>
              {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button type="button" className="m-linkbtn" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Keep it
            </button>
          </span>
        </div>
      ) : (
        <div className="m-card__foot acct-sub__actions">
          {/* An unauthorised plan has exactly one useful action. Pause and Skip
              would be meaningless on a mandate that has never been approved, and
              offering them implies the plan is running when it is not.
              `needsMandate`, NOT `!mandateActive` — a legacy pay-later plan also
              has no mandate but has nothing to authorise, and this button would
              404 on every one of them. */}
          {sub.needsMandate ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void finishAuthorization()}
              disabled={authorizing || busy !== null}
            >
              {authorizing ? 'Opening…' : 'Set up auto-pay'}
            </button>
          ) : sub.status === 'active' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => void run('pause')} disabled={busy !== null}>
                {busy === 'pause' ? 'Pausing…' : 'Pause'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void run('skip')} disabled={busy !== null}>
                {busy === 'skip' ? 'Skipping…' : 'Skip next'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => void run('resume')} disabled={busy !== null}>
              {busy === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}
          <button
            type="button"
            className="m-linkbtn acct-sub__cancel"
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
          >
            Cancel plan
          </button>
        </div>
      )}
    </article>
  )
}

// ── Addresses ────────────────────────────────────────────────────────────────

function AddressesPanel({
  addresses,
  mutate,
  onAdd,
  onEdit,
}: {
  addresses: AccountAddress[]
  mutate: (url: string, init: RequestInit) => Promise<boolean>
  onAdd: () => void
  onEdit: (address: AccountAddress) => void
}) {
  return (
    <>
      <div className="acct-panel__head">
        <div>
          <h2 className="m-h3">Saved addresses</h2>
          <p className="m-cap">Where your Femi9 orders are delivered.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onAdd}>
          Add address
        </button>
      </div>

      {addresses.length === 0 ? (
        <div className="m-empty">
          <span className="m-empty__art" aria-hidden="true"><IPin /></span>
          <h3 className="m-h3">No addresses saved</h3>
          <p>Add one now and checkout will be a single tap next time.</p>
          <button type="button" className="btn btn-ghost" onClick={onAdd}>
            Add your first address
          </button>
        </div>
      ) : (
        <div className="acct-cards">
          {addresses.map((address) => (
            <AddressCard key={address.id} address={address} mutate={mutate} onEdit={() => onEdit(address)} />
          ))}
        </div>
      )}
    </>
  )
}

function AddressCard({
  address,
  mutate,
  onEdit,
}: {
  address: AccountAddress
  mutate: (url: string, init: RequestInit) => Promise<boolean>
  onEdit: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    // Deleting is always allowed now: an address attached to an order is archived
    // rather than dropped, so the order's own record stays intact.
    await mutate(`/api/account/addresses/${address.id}`, { method: 'DELETE' })
    setBusy(false)
    setConfirming(false)
  }

  async function makeDefault() {
    setBusy(true)
    await mutate(`/api/account/addresses/${address.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    })
    setBusy(false)
  }

  return (
    <article className={`m-card acct-addr${address.primary ? ' is-default' : ''}`}>
      <div className="m-card__head">
        <div className="acct-addr__tags">
          <span className="m-chip">{address.label}</span>
          {address.primary && (
            <span className="m-chip m-chip--gold">
              <ICheck aria-hidden="true" />
              Default
            </span>
          )}
        </div>
        <div className="m-card__head-end">
          <button
            type="button"
            className="m-iconbtn"
            onClick={onEdit}
            disabled={busy}
            aria-label={`Edit the ${address.label} address`}
          >
            <IPencil aria-hidden="true" />
          </button>
          <button
            type="button"
            className="m-iconbtn m-iconbtn--danger"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-label={`Delete the ${address.label} address`}
          >
            <ITrash aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="acct-addr__body">
        <p className="acct-addr__name">{address.name}</p>
        <p className="m-cap">{address.line}</p>
        <p className="m-cap">{address.city}</p>
        <p className="m-cap m-num">{address.phone}</p>
      </div>

      {confirming ? (
        <div className="m-confirm" role="group" aria-label="Confirm deletion">
          <span>Delete this address?</span>
          <span className="m-confirm__actions">
            <button type="button" className="m-linkbtn" onClick={() => void remove()} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" className="m-linkbtn" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
          </span>
        </div>
      ) : (
        !address.primary && (
          <div className="m-card__foot">
            <button type="button" className="m-linkbtn" onClick={() => void makeDefault()} disabled={busy}>
              Make this my default
            </button>
          </div>
        )
      )}
    </article>
  )
}

// ── Profile ──────────────────────────────────────────────────────────────────

function ProfilePanel({
  user,
  notify,
  onEdit,
}: {
  user: AccountUser
  notify: (msg: string) => void
  onEdit: (focus?: 'name' | 'email' | 'phone') => void
}) {
  const [verifying, setVerifying] = useState(false)

  /** Re-send the email verification link. Real endpoint, real feedback. */
  async function verifyEmail() {
    if (!user.email || verifying) return
    setVerifying(true)
    try {
      const res = await fetch('/api/account/email/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      })
      notify(res.ok ? 'Verification link sent - check your inbox.' : (await readFailure(res)).message)
    } catch {
      notify('We could not reach the server. Check your connection and try again.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <div className="acct-panel__head">
        <div>
          <h2 className="m-h3">Profile details</h2>
          <p className="m-cap">What we call you, and how we reach you about an order.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => onEdit()}>
          Edit details
        </button>
      </div>

      <div className="m-kv">
        <div className="m-kv__row">
          <span className="m-kv__k">Full name</span>
          <span className="m-kv__v">
            {user.name ? (
              user.name
            ) : (
              <button type="button" className="m-linkbtn" onClick={() => onEdit('name')}>
                Add your name
              </button>
            )}
          </span>
        </div>

        <div className="m-kv__row">
          <span className="m-kv__k">Email</span>
          <span className="m-kv__v">
            {user.email ? (
              <>
                {user.email}
                {user.emailVerified ? (
                  <span className="m-status m-status--success">
                    <ICheck aria-hidden="true" />
                    Verified
                  </span>
                ) : (
                  <>
                    <span className="m-chip m-chip--quiet">Unverified</span>
                    <button type="button" className="m-linkbtn" onClick={() => void verifyEmail()} disabled={verifying}>
                      {verifying ? 'Sending…' : 'Send verification link'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <button type="button" className="m-linkbtn" onClick={() => onEdit('email')}>
                Add your email
              </button>
            )}
          </span>
        </div>

        <div className="m-kv__row">
          <span className="m-kv__k">Mobile</span>
          <span className="m-kv__v">
            {user.phoneDisplay ? (
              <>
                <span className="m-num">{user.phoneDisplay}</span>
                {user.phoneVerified ? (
                  <span className="m-status m-status--success">
                    <ICheck aria-hidden="true" />
                    Verified
                  </span>
                ) : (
                  <button type="button" className="m-linkbtn" onClick={() => onEdit('phone')}>
                    Verify this number
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="m-linkbtn" onClick={() => onEdit('phone')}>
                Add your mobile
              </button>
            )}
          </span>
        </div>

        <div className="m-kv__row">
          <span className="m-kv__k">Member since</span>
          <span className="m-kv__v">{user.since}</span>
        </div>
      </div>
    </>
  )
}


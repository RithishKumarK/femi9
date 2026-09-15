'use client'

/**
 * /dashboard — the member's home, built to the `Femi9 Dashboard` comp.
 *
 * The comp is a single membership screen: a purple hero carrying the greeting
 * and the identity chip, a three-way segmented control (Overview / Cycle /
 * Rewards), a metrics row with the Bloom-points ring, a sub-tabbed records card
 * (Orders / Subscriptions / Addresses / Profile), a rewards board and the
 * "Femi9 essentials" band. Its layout and copy live in `src/styles/f9dash.css`
 * and in the markup below, verbatim.
 *
 * EVERY number and string on it is the customer's own row. The comp ships
 * sample content — "0 of 500", "FM-00001", "Rs.274", a hard-coded Erode address
 * — and none of it survives here: the ring reads the points ledger, the ring's
 * target is the cheapest reward still out of reach, the order rows are the real
 * orders with a working "Buy again", the addresses are the real address book
 * and the earn rates are the live Settings values. Where the customer has no
 * rows the comp's own empty state is drawn rather than a fabricated one.
 *
 * The Cycle tab keeps the full tracker this screen already had — consent gate,
 * calendar, logging, editable history, trend and insights — restyled by the
 * `.f9dash .m-*` block at the foot of f9dash.css. Nothing was dropped to make
 * the comp fit.
 *
 * Chrome: `<MemberLayout variant="bare">`, so the storefront nav and footer
 * still wrap the page but the shared `.m-head` / `.m-bar` do not — the hero and
 * the segmented control carry the greeting, the identity and the section switch
 * themselves, and painting both would print the same name twice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link } from '@/lib/router-compat'
import { MemberLayout, MemberSignOutButton } from '@/components/MemberLayout'
import { Chip } from '@/components/Chip'
import { OptImg } from '@/components/OptImg'
import { useCart } from '@/store/cart'
import { fmtRs } from '../charts/util'
import {
  IAlert,
  IBox,
  ICheck,
  IChevron,
  ICycle,
  IHome,
  IInfo,
  IPencil,
  ISparkles,
  IStar,
  ITrash,
  ITrend,
} from '@/components/AppIcons'
import {
  PHASE_HINT,
  PHASE_LABEL,
  addDaysKey,
  clampPeriod,
  dateFromKey,
  daysBetweenKeys,
  isDayKey,
  keyFromDate,
  localDayKey,
  phaseForDayKey,
  type CyclePhase,
} from '@femi9/core/cycle-math'
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
  SubStatus,
} from '@femi9/core/services/account'
import type { RewardOptionView } from '@femi9/core/services/rewards'
import type { CycleData, PeriodEntry, SymptomEntry } from '@femi9/core/services/cycle'

export interface UserDashboardProps extends CycleData {
  /** The SAME identity /account renders. Not a bare `userName` string. */
  user: AccountUser
  pointsBalance: number
  /** ALL orders, newest first — the comp's Orders sub-tab is the full history. */
  orders: AccountOrder[]
  subscriptions: AccountSubscription[]
  addresses: AccountAddress[]
  coupons: AccountCoupon[]
  earnRates: EarnRates
  activity: ActivityItem[]
  rewardOptions: RewardOptionView[]
}

/* ── The comp's own vocabulary ─────────────────────────────────────────────── */

type SectionKey = 'overview' | 'cycle' | 'rewards'
type RecordKey = 'orders' | 'subscriptions' | 'addresses' | 'profile'

const SECTIONS: { key: SectionKey; label: string; Icon: typeof IHome }[] = [
  { key: 'overview', label: 'Overview', Icon: IHome },
  { key: 'cycle', label: 'Cycle', Icon: ICycle },
  { key: 'rewards', label: 'Rewards', Icon: ISparkles },
]

const RECORDS: { key: RecordKey; label: string }[] = [
  { key: 'orders', label: 'Orders' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'profile', label: 'Profile' },
]

/** Statuses that are not money the customer kept spending, so "Lifetime spend"
 *  must not count them. A refunded order on that tile is a small lie. */
const NON_SPEND: AccountOrder['statusKey'][] = ['cancelled', 'refunded']

/** Order status → the comp's four pill tones. */
const ORDER_PILL: Record<AccountOrder['statusKey'], string> = {
  pending: '',
  processing: '',
  paid: ' f9d-pill--active',
  shipped: ' f9d-pill--active',
  delivered: ' f9d-pill--success',
  cancelled: ' f9d-pill--danger',
  refunded: ' f9d-pill--danger',
}

/** The four moves the subscriptions endpoint accepts, and what each reports. */
type SubAction = 'pause' | 'resume' | 'skip' | 'cancel'

const SUB_DONE: Record<SubAction, string> = {
  pause: 'Subscription paused',
  resume: 'Subscription resumed',
  skip: 'Next delivery skipped',
  cancel: 'Subscription cancelled',
}

/** The three fields a PATCH can move, held optimistically until the refresh. */
interface SubPatch {
  status: SubStatus
  nextDelivery: string
  saved: number
}

const SUB_LABEL: Record<SubStatus, string> = {
  pending_mandate: 'Auto-pay not set up',
  active: 'Active',
  paused: 'Paused',
  halted: 'Payment failed',
  cancelled: 'Cancelled',
}
const SUB_PILL: Record<SubStatus, string> = {
  pending_mandate: '',
  active: ' f9d-pill--active',
  paused: '',
  // Halted is not paused: Razorpay has stopped retrying and will not restart on
  // its own, so it reads with the same weight as a cancellation.
  halted: ' f9d-pill--danger',
  cancelled: ' f9d-pill--danger',
}

/** "Rs.100 off your next order." — the sentence under a redeem card. */
const rewardDesc = (r: RewardOptionView) =>
  r.couponType === 'pct' ? `${r.couponValue}% off your next order.` : `Rs.${r.couponValue} off your next order.`

const n = (v: number) => v.toLocaleString('en-IN')

/* ── Vocabulary ─────────────────────────────────────────────────────────────
 * A real symptom set, not the six-label stub this screen used to ship. Flow is
 * separate because it is the one observation a period tracker must record, and
 * it deserves its own scale rather than a generic 0-3 intensity. */

const SYMPTOMS = [
  'Cramps',
  'Headache',
  'Backache',
  'Bloating',
  'Nausea',
  'Fatigue',
  'Mood swings',
  'Anxiety',
  'Acne',
  'Breast tenderness',
  'Cravings',
  'Sleep trouble',
] as const

/** Stored as a symptom named "Flow" so it shares the encrypted SymptomLog row
 *  shape; the level is the scale index, which is why the labels live here. */
const FLOW_SYMPTOM = 'Flow'
const FLOW_LEVELS = ['Spotting', 'Light', 'Medium', 'Heavy'] as const
const INTENSITY_LEVELS = ['None', 'Mild', 'Moderate', 'Strong'] as const

const levelLabel = (symptom: string, level: number) => {
  const scale = symptom === FLOW_SYMPTOM ? FLOW_LEVELS : INTENSITY_LEVELS
  return scale[Math.min(scale.length - 1, Math.max(0, level))]
}

/** localStorage key the landing tracker writes a signed-out visitor's dates to. */
const GUEST_TRACKER_KEY = 'femi9.cycle.guest'

/* ── Request helper ─────────────────────────────────────────────────────────
 * Every cycle write goes through this so failures are handled identically:
 * we never assume success, we surface the server's own message, and a consent
 * refusal is recognisable to the caller so the gate can be re-shown. */

interface ApiFailure {
  status: number
  message: string
  code?: string
  consentRequired: boolean
}

type ApiResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: ApiFailure }

async function callApi<T = Record<string, unknown>>(
  url: string,
  init: { method: string; body?: unknown },
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    return {
      ok: false,
      error: { status: 0, message: 'We could not reach Femi9. Check your connection and try again.', consentRequired: false },
    }
  }

  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null

  if (!res.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : undefined
    const message =
      (typeof payload?.error === 'string' && payload.error) ||
      (res.status === 401
        ? 'Your session has expired. Sign in again to keep tracking.'
        : res.status === 503
          ? 'Cycle tracking is temporarily unavailable. Please try again shortly.'
          : 'We could not save that. Please try again.')
    return {
      ok: false,
      error: { status: res.status, message, code, consentRequired: res.status === 403 || code === 'consent_required' },
    }
  }
  return { ok: true, data: (payload ?? {}) as T }
}

/* ── Small presentational helpers ──────────────────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** The header row is aria-hidden: each day button already names its own weekday
 *  in full through `fmtFullKey`, so a screen reader gets it without the letters. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** "14 Aug 2026" from a day key. UTC getters, because a key is a UTC-midnight day. */
function fmtFullKey(key: string): string {
  return dateFromKey(key).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
function fmtDayMonth(key: string): string {
  return dateFromKey(key).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' })
}

const toneIcon = { good: ICheck, warning: IAlert, info: IInfo } as const

/** Inline status line for a form. Never an alert(); never a silent failure. */
function FormMessage({ tone, children }: { tone: 'ok' | 'err'; children: React.ReactNode }) {
  return (
    <p className={`dash-msg dash-msg--${tone}`} role={tone === 'err' ? 'alert' : 'status'}>
      {tone === 'err' ? <IAlert aria-hidden="true" /> : <ICheck aria-hidden="true" />}
      <span>{children}</span>
    </p>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function UserDashboard(props: UserDashboardProps) {
  const {
    user,
    consent,
    needsData,
    today,
    timezone,
    prediction,
    upcomingEvents,
    cycleLengthTrend,
    insights,
    symptomLog,
    periods,
    unreadableRows,
    pointsBalance,
    orders,
    subscriptions,
    addresses,
    coupons,
    earnRates,
    activity,
    rewardOptions,
  } = props

  const router = useRouter()
  const { notify, add, openCart } = useCart()

  /**
   * The browser's own calendar day. The server resolves `today` in the store's
   * timezone, which is right for almost everyone but cannot be right for
   * everyone — so every WRITE carries the client's day and the API validates
   * against that with a tolerance. `new Date().toISOString()` would be the UTC
   * day, which in IST is yesterday until 05:30 and is exactly the bug that made
   * the API reject a user's real today.
   */
  const clientToday = useMemo(() => localDayKey(), [])

  /**
   * A write can be refused for consent even when the page was rendered with
   * consent true (another tab withdrew it). When that happens we flip back to
   * the gate rather than leaving the user typing into a form that will not save.
   */
  const [consentRefused, setConsentRefused] = useState(false)
  const gateOpen = !consent || consentRefused

  const onConsentRefusal = useCallback(() => {
    setConsentRefused(true)
    router.refresh()
  }, [router])

  /* ── The comp's two tab strips ──────────────────────────────────────────── */

  const [sec, setSec] = useState<SectionKey>('overview')
  const [rec, setRec] = useState<RecordKey>('orders')
  const secRefs = useRef<Partial<Record<SectionKey, HTMLButtonElement | null>>>({})
  const recRefs = useRef<Partial<Record<RecordKey, HTMLButtonElement | null>>>({})
  const trackerRef = useRef<HTMLDivElement>(null)

  /** `/dashboard#cycle` and `#rewards` open on that section. The member sub-nav
   *  and the footer both link here by hash, and without this they would land on
   *  Overview with the section they asked for hidden behind a tab. Read once on
   *  mount — reading location during render would break hydration. */
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash === 'cycle' || hash === 'rewards') setSec(hash)
  }, [])

  function onSecKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = SECTIONS.findIndex((t) => t.key === sec)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % SECTIONS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + SECTIONS.length) % SECTIONS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = SECTIONS.length - 1
    else return
    e.preventDefault()
    const key = SECTIONS[next].key
    setSec(key)
    secRefs.current[key]?.focus()
  }

  function onRecKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = RECORDS.findIndex((t) => t.key === rec)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % RECORDS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + RECORDS.length) % RECORDS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = RECORDS.length - 1
    else return
    e.preventDefault()
    const key = RECORDS[next].key
    setRec(key)
    recRefs.current[key]?.focus()
  }

  /* ── Real figures behind the comp's sample numbers ──────────────────────── */

  /** The hero italicises the first name only. `displayName` is the full string
   *  and is the literal 'Your account' for a nameless row, which must never be
   *  greeted — so this is null then and the greeting stays "Welcome back". */
  const firstName = user.name?.trim().split(/\s+/)[0] ?? null

  const lifetimeSpend = useMemo(
    () => orders.filter((o) => !NON_SPEND.includes(o.statusKey)).reduce((sum, o) => sum + o.total, 0),
    [orders],
  )
  const activeSubscriptions = useMemo(
    () => subscriptions.filter((s) => s.status !== 'cancelled'),
    [subscriptions],
  )

  /** The cheapest reward still out of reach — the comp's "500 points to Rs.100
   *  off" and the ring's denominator both read from it. Null once every reward
   *  is affordable (or the catalogue is empty), which the copy then states
   *  rather than inventing a target. */
  const ladder = useMemo(
    () => [...rewardOptions].sort((a, b) => a.costPoints - b.costPoints),
    [rewardOptions],
  )
  const nextReward = useMemo(
    () => ladder.find((r) => r.costPoints > pointsBalance) ?? null,
    [ladder, pointsBalance],
  )
  const pointsToGo = nextReward ? nextReward.costPoints - pointsBalance : 0
  const pointsRatio = nextReward ? Math.min(1, Math.max(0, pointsBalance / nextReward.costPoints)) : 1

  const recordCounts: Record<RecordKey, number | null> = {
    orders: orders.length,
    subscriptions: activeSubscriptions.length,
    addresses: addresses.length,
    profile: null,
  }

  /* ── Actions the comp's buttons actually perform ────────────────────────── */

  const [reordering, setReordering] = useState<string | null>(null)
  async function buyAgain(order: AccountOrder) {
    const lines = order.items.filter((i) => i.variantId)
    if (lines.length === 0 || reordering) return
    setReordering(order.id)
    try {
      // Sequential: the cart API returns the whole cart each time, so parallel
      // writes would race each other's snapshot.
      for (const line of lines) await add(line.variantId, line.qty)
      openCart()
    } finally {
      setReordering(null)
    }
  }

  /* ── The three write surfaces, on this screen rather than on /account ──── */

  const [profileSheet, setProfileSheet] = useState<{ focus?: 'name' | 'email' | 'phone' } | null>(null)
  const [addressSheet, setAddressSheet] = useState<{ address: AccountAddress | null } | null>(null)

  /**
   * Optimistic subscription state, held ONLY between a PATCH response and the
   * server re-render it triggers. A new `subscriptions` array means the page
   * re-rendered against fresh DB rows, so the local copy is dropped and server
   * truth wins.
   */
  const [subPatches, setSubPatches] = useState<Record<string, SubPatch>>({})
  useEffect(() => {
    setSubPatches({})
  }, [subscriptions])

  /**
   * One fire-and-refresh helper for the address controls. A failure becomes a
   * toast carrying the server's own message — never an alert(), never a silent
   * revert.
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

  const [redeeming, setRedeeming] = useState<string | null>(null)
  async function redeem(r: RewardOptionView) {
    if (pointsBalance < r.costPoints || redeeming) return
    setRedeeming(r.id)
    try {
      const res = await fetch('/api/rewards/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rewardOptionId: r.id }),
      })
      const data = (await res.json().catch(() => null)) as { couponCode?: string; error?: string } | null
      if (!res.ok) {
        notify(data?.error ?? 'Could not redeem that reward right now. Please try again.')
        return
      }
      // The code is persisted against the account, so "Your reward codes" below
      // is the permanent copy — this toast is a convenience, not the delivery.
      notify(data?.couponCode ? `Redeemed. Your code is ${data.couponCode}` : 'Reward redeemed')
      router.refresh()
    } catch {
      notify('We could not reach Femi9. Check your connection and try again.')
    } finally {
      setRedeeming(null)
    }
  }

  /** The comp's "Track your cycle" moves to the Cycle section and scrolls to the
   *  live tracker under its intro card. */
  const goTrack = useCallback(() => {
    setSec('cycle')
    // Next frame: the panel does not exist in the DOM until the state lands.
    requestAnimationFrame(() => trackerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  /* ── Ring geometry (the comp's own numbers) ─────────────────────────────── */

  const POINTS_R = 52
  const POINTS_C = 2 * Math.PI * POINTS_R
  const DIAL_R = 82
  const DIAL_C = 2 * Math.PI * DIAL_R
  const dialRatio =
    gateOpen || needsData ? 0.3 : Math.min(1, Math.max(0, prediction.cycleDay / prediction.avgCycle))

  return (
    <MemberLayout
      variant="bare"
      identity={{
        displayName: user.displayName,
        initials: user.initials,
        tier: user.tier,
        image: user.image,
      }}
      active="cycle"
      title={user.greeting}
    >
      <div className="f9dash">
        {/* ── Membership hero ──────────────────────────────────────────── */}
        <section className="f9d-hero" aria-labelledby="f9d-hero-h">
          <span className="f9d-disp f9d-hero__ghost" aria-hidden="true">
            Femi9
          </span>
          <span className="f9d-hero__glow" aria-hidden="true" />
          <div className="f9d-hero__inner">
            <div className="f9d-hero__copy">
              <span className="f9d-ey f9d-ey--gold">Your membership</span>
              <h1 className="f9d-disp f9d-hero__title" id="f9d-hero-h">
                Welcome back{firstName && <>, <em>{firstName}</em></>}
              </h1>
              <p className="f9d-hero__lead">
                Your orders, Bloom points, refills and delivery details - all in one place.
              </p>
              <div className="f9d-hero__id">
                <span className="f9d-disp f9d-hero__avatar" aria-hidden="true">
                  {user.image ? (
                    <img src={user.image} alt="" width={44} height={44} decoding="async" />
                  ) : (
                    user.initials
                  )}
                </span>
                <span className="f9d-hero__idtext">
                  <span className="f9d-hero__name">{user.displayName}</span>
                  <span className="f9d-hero__tier">
                    {user.tier} · since {user.since}
                  </span>
                </span>
              </div>
            </div>
            <div className="f9d-hero__actions">
              <button
                type="button"
                className="f9d-btn f9d-btn--light"
                onClick={() => {
                  setSec('overview')
                  setRec('profile')
                }}
              >
                <IPencil width={15} height={15} />
                Edit profile
              </button>
              <MemberSignOutButton variant="plain" className="f9d-btn f9d-btn--light" />
            </div>
          </div>
        </section>

        {/* ── Overview / Cycle / Rewards ───────────────────────────────── */}
        <div className="f9d-seg" role="tablist" aria-label="Dashboard sections" onKeyDown={onSecKeyDown}>
          <span
            className="f9d-seg__thumb"
            aria-hidden="true"
            style={{ transform: `translateX(${SECTIONS.findIndex((t) => t.key === sec) * 100}%)` }}
          />
          {SECTIONS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`f9d-sec-${key}`}
              className="f9d-seg__btn"
              aria-selected={sec === key}
              aria-controls={`f9d-panel-${key}`}
              tabIndex={sec === key ? 0 : -1}
              onClick={() => setSec(key)}
              ref={(el) => {
                secRefs.current[key] = el
              }}
            >
              <Icon width={17} height={17} />
              {label}
            </button>
          ))}
        </div>

        {/* ══ OVERVIEW ═════════════════════════════════════════════════ */}
        {sec === 'overview' && (
          <div id="f9d-panel-overview" role="tabpanel" aria-labelledby="f9d-sec-overview" tabIndex={0}>
            <div className="f9d-metrics">
              {/* Bloom points — the ring reads the ledger, its denominator is the
                  cheapest reward still out of reach. */}
              <div className="f9d-card f9d-points">
                <div className="f9d-ring">
                  <svg width="118" height="118" viewBox="0 0 118 118" aria-hidden="true">
                    <circle cx="59" cy="59" r={POINTS_R} fill="none" stroke="rgba(52,32,78,.12)" strokeWidth="11" />
                    <circle
                      cx="59"
                      cy="59"
                      r={POINTS_R}
                      fill="none"
                      stroke="#F0C14E"
                      strokeWidth="11"
                      strokeLinecap="round"
                      strokeDasharray={POINTS_C.toFixed(1)}
                      strokeDashoffset={(POINTS_C * (1 - pointsRatio)).toFixed(1)}
                      transform="rotate(-90 59 59)"
                    />
                  </svg>
                  <span className="f9d-ring__label">
                    <span className="f9d-disp f9d-num f9d-ring__value">{n(pointsBalance)}</span>
                    {nextReward && <span className="f9d-ring__of">of {n(nextReward.costPoints)}</span>}
                  </span>
                </div>
                <div>
                  <span className="f9d-ey">Bloom points</span>
                  <div className="f9d-disp f9d-points__title">
                    {nextReward ? (
                      <>
                        {n(pointsToGo)} points to <em>{nextReward.title}</em>
                      </>
                    ) : ladder.length > 0 ? (
                      <>
                        Every reward is <em>within reach</em>
                      </>
                    ) : (
                      <>
                        Points on <em>every order</em>
                      </>
                    )}
                  </div>
                  <p className="f9d-points__note">Earn on every order and redeem for real discounts.</p>
                </div>
              </div>

              <div className="f9d-card f9d-metric">
                <div className="f9d-metric__top">
                  <span className="f9d-ey">Orders placed</span>
                  <span className="f9d-metric__icon" aria-hidden="true">
                    <IBox width={18} height={18} />
                  </span>
                </div>
                <span className="f9d-disp f9d-num f9d-metric__value">{n(orders.length)}</span>
                <p className="f9d-metric__note">
                  {orders.length > 0 ? `Most recent ${orders[0].date}` : 'Your first order is waiting'}
                </p>
              </div>

              <div className="f9d-card f9d-metric">
                <div className="f9d-metric__top">
                  <span className="f9d-ey">Lifetime spend</span>
                  <span className="f9d-metric__icon f9d-metric__icon--gold" aria-hidden="true">
                    ₹
                  </span>
                </div>
                <span className="f9d-disp f9d-num f9d-metric__value">{fmtRs(lifetimeSpend)}</span>
                <p className="f9d-metric__note">Member since {user.since}</p>
              </div>
            </div>

            {/* ── Records ─────────────────────────────────────────────── */}
            <section className="f9d-card f9d-records" style={{ marginTop: 16 }} aria-label="Your records">
              <div className="f9d-subrow" role="tablist" aria-label="Account records" onKeyDown={onRecKeyDown}>
                {RECORDS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`f9d-rec-${key}`}
                    className="f9d-subtab"
                    aria-selected={rec === key}
                    aria-controls={`f9d-recpanel-${key}`}
                    tabIndex={rec === key ? 0 : -1}
                    onClick={() => setRec(key)}
                    ref={(el) => {
                      recRefs.current[key] = el
                    }}
                  >
                    {label}
                    {recordCounts[key] !== null && (
                      <span
                        className={`f9d-num f9d-subtab__count${recordCounts[key] === 0 ? ' f9d-subtab__count--zero' : ''}`}
                      >
                        {recordCounts[key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div
                className="f9d-panel"
                role="tabpanel"
                id={`f9d-recpanel-${rec}`}
                aria-labelledby={`f9d-rec-${rec}`}
                tabIndex={0}
              >
                {rec === 'orders' &&
                  (orders.length === 0 ? (
                    <div className="f9d-empty">
                      <span className="f9d-empty__art" aria-hidden="true">
                        <IBox width={28} height={28} />
                      </span>
                      <div className="f9d-disp f9d-empty__title">No orders yet</div>
                      <p>Every Femi9 order lands here with its items, its total and where it has reached.</p>
                      <Link className="f9d-btn f9d-btn--ghost" to="/shop">
                        Shop the range
                      </Link>
                    </div>
                  ) : (
                    orders.map((o) => (
                      <div className="f9d-tile f9d-order" key={o.id}>
                        <span className="f9d-order__art" aria-hidden="true">
                          <IBox width={24} height={24} />
                        </span>
                        <div className="f9d-order__body">
                          <Link className="f9d-disp f9d-order__no" to={o.href} style={{ display: 'block' }}>
                            {o.id}
                          </Link>
                          <div className="f9d-num f9d-order__meta">
                            {o.date}
                            {o.items.length > 0 && ` · ${o.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}`}
                          </div>
                          {o.items.some((i) => i.variantId) && (
                            <button
                              type="button"
                              className="f9d-order__again"
                              onClick={() => void buyAgain(o)}
                              disabled={reordering !== null}
                            >
                              {reordering === o.id ? 'Adding…' : 'Buy again →'}
                            </button>
                          )}
                        </div>
                        <div className="f9d-order__end">
                          <div className="f9d-disp f9d-num f9d-order__total">{fmtRs(o.total)}</div>
                          <span className={`f9d-pill${ORDER_PILL[o.statusKey]}`}>{o.status}</span>
                        </div>
                      </div>
                    ))
                  ))}

                {rec === 'subscriptions' &&
                  (subscriptions.length === 0 ? (
                    <div className="f9d-empty">
                      <span className="f9d-empty__art" aria-hidden="true">
                        <ICycle width={28} height={28} />
                      </span>
                      <div className="f9d-disp f9d-empty__title">No refills yet</div>
                      <p>Set up a refill plan you can pause, skip or cancel whenever your month changes shape.</p>
                      <Link className="f9d-btn f9d-btn--ghost" to="/shop">
                        Start a refill plan
                      </Link>
                    </div>
                  ) : (
                    // Every plan, not only the running ones: a cancelled plan
                    // that vanished behind the empty state would read as though
                    // the cancellation had lost the record.
                    subscriptions.map((s) => (
                      <SubscriptionRow
                        key={s.id}
                        sub={{ ...s, ...(subPatches[s.id] ?? {}) }}
                        notify={notify}
                        onApplied={(patch) => {
                          setSubPatches((prev) => ({ ...prev, [s.id]: patch }))
                          router.refresh()
                        }}
                      />
                    ))
                  ))}

                {rec === 'addresses' && (
                  <div className="f9d-addrs">
                    {addresses.map((a) => (
                      <AddressCard
                        key={a.id}
                        address={a}
                        mutate={mutate}
                        onEdit={() => setAddressSheet({ address: a })}
                      />
                    ))}
                    <button
                      type="button"
                      className="f9d-tile f9d-addr-add"
                      onClick={() => setAddressSheet({ address: null })}
                    >
                      <span className="f9d-addr-add__plus" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </span>
                      Add a new address
                    </button>
                  </div>
                )}

                {rec === 'profile' && (
                  <div className="f9d-facts">
                    {/* Each field opens the sheet focused on itself, so "my
                        email is wrong" is one tap rather than a hunt. */}
                    <button
                      type="button"
                      className="f9d-fact f9d-fact--edit"
                      onClick={() => setProfileSheet({ focus: 'name' })}
                    >
                      <span className="f9d-fact__label">Full name</span>
                      <span className="f9d-disp f9d-fact__value">{user.name ?? 'Add your name'}</span>
                      <span className="f9d-fact__pencil" aria-hidden="true">
                        <IPencil width={15} height={15} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="f9d-fact f9d-fact--edit"
                      onClick={() => setProfileSheet({ focus: 'email' })}
                    >
                      <span className="f9d-fact__label">Email</span>
                      <span className="f9d-fact__value">{user.email ?? 'Add your email'}</span>
                      {user.email && !user.emailVerified && (
                        <span className="f9d-fact__flag">Unverified</span>
                      )}
                      <span className="f9d-fact__pencil" aria-hidden="true">
                        <IPencil width={15} height={15} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="f9d-fact f9d-fact--edit"
                      onClick={() => setProfileSheet({ focus: 'phone' })}
                    >
                      <span className="f9d-fact__label">Mobile</span>
                      <span className="f9d-num f9d-fact__value">
                        {user.phoneDisplay ?? 'Add your mobile'}
                      </span>
                      <span className="f9d-fact__pencil" aria-hidden="true">
                        <IPencil width={15} height={15} />
                      </span>
                    </button>
                    <div className="f9d-fact">
                      <span className="f9d-fact__label">Member tier</span>
                      <span className="f9d-disp f9d-fact__value">{user.tier}</span>
                    </div>
                    <div className="f9d-facts__foot">
                      <button
                        type="button"
                        className="f9d-btn f9d-btn--ghost"
                        onClick={() => setProfileSheet({})}
                      >
                        Edit profile details
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ══ CYCLE ════════════════════════════════════════════════════ */}
        {sec === 'cycle' && (
          <div id="f9d-panel-cycle" role="tabpanel" aria-labelledby="f9d-sec-cycle" tabIndex={0}>
            <div className="f9d-card f9d-cycle">
              <div className="f9d-cycle__copy">
                <span className="f9d-ey">Your cycle</span>
                <h2 className="f9d-disp f9d-cycle__title">
                  Know your cycle. <em>Plan</em> ahead.
                </h2>
                <p className="f9d-cycle__lead">
                  Log your last period date and we&apos;ll show your next predicted date, fertile window and a gentle
                  refill reminder - private to you.
                </p>
                <div className="f9d-cycle__actions">
                  <button type="button" className="f9d-btn f9d-btn--ghost" onClick={goTrack}>
                    Track your cycle
                  </button>
                </div>
              </div>
              <div className="f9d-cycle__dial">
                <svg width="190" height="190" viewBox="0 0 190 190" aria-hidden="true">
                  <circle cx="95" cy="95" r={DIAL_R} fill="#FDFCFA" stroke="rgba(52,32,78,.1)" strokeWidth="3" />
                  <circle
                    cx="95"
                    cy="95"
                    r={DIAL_R}
                    fill="none"
                    stroke="#C9AEE4"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={DIAL_C.toFixed(0)}
                    strokeDashoffset={(DIAL_C * (1 - dialRatio)).toFixed(0)}
                    transform="rotate(-90 95 95)"
                  />
                </svg>
                <div className="f9d-cycle__dialtext">
                  <span className="f9d-cycle__dialcap">Next period</span>
                  <span className="f9d-disp f9d-cycle__dialmain">
                    {gateOpen || needsData ? 'Add date' : prediction.nextStartLabel}
                  </span>
                  <span className="f9d-cycle__dialsub">
                    {gateOpen || needsData
                      ? 'to predict'
                      : prediction.daysUntilNext === 0
                        ? 'expected today'
                        : `in ${prediction.daysUntilNext} day${prediction.daysUntilNext === 1 ? '' : 's'}`}
                  </span>
                </div>
              </div>
            </div>

            {/* The live tracker, unchanged in behaviour and restyled by the
                `.f9dash .m-*` block in f9dash.css. */}
            <div className="f9d-tracker" ref={trackerRef} style={{ marginTop: 18 }}>
              {/* A row we cannot decrypt is skipped, never fatal. Say so plainly
                  rather than silently under-reporting a user's history. */}
              {unreadableRows > 0 && (
                <p className="m-note m-note--warning" role="status">
                  <IAlert aria-hidden="true" />
                  <span>
                    We could not read {unreadableRows} entr{unreadableRows === 1 ? 'y' : 'ies'} from your history, so
                    {unreadableRows === 1 ? ' it is' : ' they are'} left out of the numbers below. Everything else is
                    intact - you can re-log {unreadableRows === 1 ? 'that day' : 'those days'} at any time.
                  </span>
                </p>
              )}

              {gateOpen ? (
                <ConsentGate
                  onGranted={() => {
                    setConsentRefused(false)
                    router.refresh()
                  }}
                  onDecline={() => setSec('overview')}
                  notify={notify}
                />
              ) : (
                <GuestImport clientToday={clientToday} notify={notify} onConsentRefused={onConsentRefusal} />
              )}

              {/* Prediction hero, or the first-run invitation. */}
              {needsData || gateOpen ? (
                <section className="m-card m-card--roomy dash-onboard" aria-labelledby="dash-onboard-h">
                  <div className="dash-onboard__copy">
                    <span className="eyebrow">Cycle tracking</span>
                    <h2 className="m-h2" id="dash-onboard-h">
                      {gateOpen ? 'Turn on tracking to see your predictions' : 'Log your first period'}
                    </h2>
                    <p className="m-body">
                      {gateOpen
                        ? 'Once tracking is on, tell us when your last period started and this page fills in with your next date, your fertile window and your PMS days.'
                        : 'Tell us when your last period started and we will predict your next one, map your fertile and PMS windows, and keep your calendar in sync - all from your own data, never an average.'}
                    </p>
                    <ul className="dash-onboard__list">
                      <li>
                        <ICheck aria-hidden="true" /> Your next period date, refined with every cycle you log
                      </li>
                      <li>
                        <ICheck aria-hidden="true" /> Fertile window, ovulation and PMS days on one calendar
                      </li>
                      <li>
                        <ICheck aria-hidden="true" /> Symptoms and flow, so you can see your own patterns
                      </li>
                    </ul>
                  </div>
                </section>
              ) : (
                <section className="m-card m-card--roomy dash-hero" aria-labelledby="dash-hero-h">
                  <div className="dash-hero__copy">
                    <span className="eyebrow">Your prediction</span>
                    <h2 className="m-h2" id="dash-hero-h">
                      {prediction.daysUntilNext === 0
                        ? 'Your period is expected today'
                        : `Period in ${prediction.daysUntilNext} day${prediction.daysUntilNext === 1 ? '' : 's'}`}
                    </h2>
                    <p className="m-body">
                      Expected around {prediction.nextStartLabel}. You are on day {prediction.cycleDay} of a{' '}
                      {prediction.avgCycle}-day cycle, with {prediction.confidence}% confidence from your logged history.
                    </p>
                    <div className="dash-hero__chips">
                      <span className="m-chip m-chip--gold">
                        <ICycle aria-hidden="true" /> Next: {prediction.nextStartLabel}
                      </span>
                      <span className="m-chip">Ovulation {fmtDayMonth(prediction.ovulation)}</span>
                      <span className="m-chip m-chip--quiet">
                        Fertile {fmtDayMonth(prediction.fertileStart)} – {fmtDayMonth(prediction.fertileEnd)}
                      </span>
                    </div>
                  </div>
                  <CycleRing
                    cycleDay={prediction.cycleDay}
                    avgCycle={prediction.avgCycle}
                    confidence={prediction.confidence}
                  />
                </section>
              )}

              {/* Calendar + upcoming. */}
              {!gateOpen && !needsData && (
                <div className="m-grid" id="cycle">
                  <section className="m-card m-span-8" aria-labelledby="dash-cal-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-cal-h">
                          Cycle calendar
                        </h2>
                        <p>Days you logged, and the windows we predict from them.</p>
                      </div>
                    </div>
                    <PhaseCalendar
                      today={today}
                      prediction={prediction}
                      periods={periods}
                      symptoms={symptomLog}
                      timezone={timezone}
                    />
                  </section>

                  <section className="m-card m-span-4" aria-labelledby="dash-upcoming-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-upcoming-h">
                          What is coming
                        </h2>
                        <p>Predicted, {prediction.confidence}% confidence.</p>
                      </div>
                    </div>
                    <ul className="dash-upcoming">
                      {upcomingEvents.map((e) => (
                        <li key={e.label} className="dash-upcoming__item" data-phase={e.phase}>
                          <span className="dash-upcoming__marker" aria-hidden="true" />
                          <span className="dash-upcoming__body">
                            <span className="m-row__title">{e.label}</span>
                            <span className="m-row__meta">
                              {e.range}
                              {e.days > 0
                                ? ` · in ${e.days} day${e.days === 1 ? '' : 's'}`
                                : e.days === 0
                                  ? ' · today'
                                  : ''}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}

              {/* Logging. */}
              {!gateOpen && (
                <div className="m-grid">
                  <section className="m-card m-span-6" aria-labelledby="dash-logp-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-logp-h">
                          {needsData ? 'Log your first period' : 'Log a period'}
                        </h2>
                        <p>Re-logging the same day corrects it instead of adding a duplicate.</p>
                      </div>
                    </div>
                    <PeriodForm
                      maxDate={clientToday}
                      defaultLength={prediction.avgPeriod}
                      clientToday={clientToday}
                      onSaved={() => router.refresh()}
                      onConsentRefused={onConsentRefusal}
                      notify={notify}
                    />
                  </section>

                  <section className="m-card m-span-6" aria-labelledby="dash-logs-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-logs-h">
                          Log how you feel
                        </h2>
                        <p>Pick any day, any number of symptoms, and your flow.</p>
                      </div>
                    </div>
                    <SymptomForm
                      maxDate={clientToday}
                      clientToday={clientToday}
                      onSaved={() => router.refresh()}
                      onConsentRefused={onConsentRefusal}
                      notify={notify}
                    />
                  </section>
                </div>
              )}

              {/* Logged history. */}
              {!gateOpen && (
                <div className="m-grid">
                  <section className="m-card m-span-6" aria-labelledby="dash-hist-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-hist-h">
                          Your logged periods
                        </h2>
                        <p>Newest first. One wrong date skews every prediction, so fix it here.</p>
                      </div>
                    </div>
                    <PeriodHistory
                      periods={periods}
                      maxDate={clientToday}
                      clientToday={clientToday}
                      onChanged={() => router.refresh()}
                      onConsentRefused={onConsentRefusal}
                      notify={notify}
                    />
                  </section>

                  <section className="m-card m-span-6" aria-labelledby="dash-symp-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-symp-h">
                          Symptoms you logged
                        </h2>
                        <p>Grouped by whether they fall in the cycle you are in now.</p>
                      </div>
                    </div>
                    <SymptomHistory entries={symptomLog} onChanged={() => router.refresh()} notify={notify} />
                  </section>
                </div>
              )}

              {/* Trend + insights. */}
              {!gateOpen && !needsData && (
                <div className="m-grid">
                  <section className="m-card m-span-6" aria-labelledby="dash-trend-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-trend-h">
                          Cycle length trend
                        </h2>
                        <p>
                          {cycleLengthTrend.measured < 2
                            ? 'Measured from the gaps between your logged periods.'
                            : `Your last ${cycleLengthTrend.values.length} measured cycle${cycleLengthTrend.values.length === 1 ? '' : 's'}, in days.`}
                        </p>
                      </div>
                    </div>
                    {cycleLengthTrend.measured < 2 ? (
                      <div className="m-empty">
                        <span className="m-empty__art">
                          <ITrend aria-hidden="true" />
                        </span>
                        <h3 className="m-h3">Log two periods to see your trend</h3>
                        <p>
                          A cycle length is the gap between two starts, so we need two before there is anything honest
                          to chart.
                        </p>
                      </div>
                    ) : (
                      <TrendBars labels={cycleLengthTrend.labels} values={cycleLengthTrend.values} />
                    )}
                  </section>

                  <section className="m-card m-span-6" aria-labelledby="dash-insight-h">
                    <div className="m-card__head">
                      <div>
                        <h2 className="m-h3" id="dash-insight-h">
                          This cycle
                        </h2>
                        <p>Read from your own logs.</p>
                      </div>
                    </div>
                    <ul className="dash-insights">
                      {insights.map((it) => {
                        const Icon = toneIcon[it.tone]
                        return (
                          <li key={it.title} className="dash-insight" data-tone={it.tone}>
                            <span className="dash-insight__icon">
                              <Icon aria-hidden="true" />
                            </span>
                            <span>
                              <b className="m-row__title">{it.title}</b>
                              <span className="m-row__meta">{it.body}</span>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                </div>
              )}

              {/* Privacy. */}
              {!gateOpen && <CyclePrivacy notify={notify} onWithdrawn={() => router.refresh()} />}
            </div>
          </div>
        )}

        {/* ══ REWARDS ══════════════════════════════════════════════════ */}
        {sec === 'rewards' && (
          <div id="f9d-panel-rewards" role="tabpanel" aria-labelledby="f9d-sec-rewards" tabIndex={0}>
            <section className="f9d-card f9d-rewards" aria-labelledby="f9d-rewards-h">
              <span className="f9d-ey">Femi9 Rewards</span>
              <h2 className="f9d-disp f9d-rewards__title" id="f9d-rewards-h">
                Earn Bloom points, turn them into <em>real discounts</em>.
              </h2>
              <div className="f9d-earn-two">
                <div className="f9d-balance">
                  <span className="f9d-balance__cap">Your balance</span>
                  <span className="f9d-disp f9d-num f9d-balance__value">{n(pointsBalance)}</span>
                  <div className="f9d-balance__unit">Bloom points</div>
                  <div className="f9d-bar">
                    <span
                      className="f9d-bar__fill"
                      style={{ '--f9-pct': `${Math.round(pointsRatio * 100)}%` } as React.CSSProperties}
                    />
                  </div>
                  <p className="f9d-balance__note">
                    {nextReward ? (
                      <>
                        {n(pointsToGo)} points to <b>{rewardDesc(nextReward).replace(/\.$/, '')}</b>
                      </>
                    ) : ladder.length > 0 ? (
                      <>Every reward below is <b>within reach</b></>
                    ) : (
                      <>Points land on every paid order</>
                    )}
                  </p>
                </div>

                <div>
                  <span className="f9d-cap">Ways to earn</span>
                  <div className="f9d-earn-list">
                    <div className="f9d-earn-row">
                      <span className="f9d-earn-row__icon" aria-hidden="true">
                        ₹
                      </span>
                      <span className="f9d-earn-row__label">Every Rs.1 you spend</span>
                      <span className="f9d-disp f9d-num f9d-earn-row__pts">+{n(earnRates.pointsPerRupee)}</span>
                    </div>
                    <div className="f9d-earn-row">
                      <span className="f9d-earn-row__icon" aria-hidden="true">
                        <IStar width={19} height={19} />
                      </span>
                      <span className="f9d-earn-row__label">Write a product review</span>
                      <span className="f9d-disp f9d-num f9d-earn-row__pts">+{n(earnRates.reviewPoints)}</span>
                    </div>
                    <div className="f9d-earn-row">
                      <span className="f9d-earn-row__icon" aria-hidden="true">
                        <IBox width={19} height={19} />
                      </span>
                      <span className="f9d-earn-row__label">
                        First order bonus
                        {earnRates.firstOrderBonusEarned && ' · earned'}
                      </span>
                      <span className="f9d-disp f9d-num f9d-earn-row__pts">
                        +{n(earnRates.firstOrderBonusPoints)}
                      </span>
                    </div>
                  </div>
                  {/* Thara is the referral programme a customer is sent to.
                      /affiliate is a different surface and is not this link. */}
                  <Link className="f9d-refer" to="/thara">
                    Refer a friend
                    <IChevron width={15} height={15} />
                  </Link>
                </div>
              </div>
            </section>

            {ladder.length > 0 && (
              <>
                <div style={{ marginTop: 20 }}>
                  <span className="f9d-cap">Redeem your points</span>
                </div>
                <div className="f9d-redeem">
                  {ladder.map((r) => {
                    const ratio = Math.min(1, Math.max(0, pointsBalance / r.costPoints))
                    const affordable = pointsBalance >= r.costPoints
                    return (
                      <div className="f9d-tile f9d-card f9d-reward" key={r.id}>
                        <div className="f9d-reward__top">
                          <h3 className="f9d-disp f9d-reward__name">{r.title}</h3>
                          <span className="f9d-num f9d-reward__cost">{n(r.costPoints)} pts</span>
                        </div>
                        <p className="f9d-reward__desc">{rewardDesc(r)}</p>
                        <div className="f9d-bar f9d-bar--thin">
                          <span
                            className="f9d-bar__fill"
                            style={{ '--f9-pct': `${Math.round(ratio * 100)}%` } as React.CSSProperties}
                          />
                        </div>
                        {affordable ? (
                          <button
                            type="button"
                            className="f9d-btn f9d-btn--gold f9d-reward__btn"
                            onClick={() => void redeem(r)}
                            disabled={redeeming !== null}
                          >
                            {redeeming === r.id ? 'Redeeming…' : 'Redeem now'}
                          </button>
                        ) : (
                          <p className="f9d-num f9d-reward__togo">
                            {n(r.costPoints - pointsBalance)} points to go
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div className="f9d-two">
              <section className="f9d-card f9d-note" aria-labelledby="f9d-codes-h">
                <span className="f9d-cap" id="f9d-codes-h">
                  Your reward codes
                </span>
                {coupons.length === 0 ? (
                  <p>Redeemed codes are saved here, so you never have to remember one.</p>
                ) : (
                  <div className="f9d-codes">
                    {coupons.map((c) => (
                      <div className="f9d-code" key={c.id}>
                        <span>
                          <span className="f9d-num f9d-code__value">{c.code}</span>
                          <span className="f9d-code__meta" style={{ display: 'block' }}>
                            {c.label}
                            {c.expires && ` · expires ${c.expires}`}
                          </span>
                        </span>
                        <span className={`f9d-pill${c.used ? '' : ' f9d-pill--active'}`} style={{ marginTop: 0 }}>
                          {c.used ? 'Used' : 'Ready'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="f9d-card f9d-note" aria-labelledby="f9d-activity-h">
                <span className="f9d-cap" id="f9d-activity-h">
                  Recent activity
                </span>
                {activity.length === 0 ? (
                  <p>Points you earn and spend will be listed here.</p>
                ) : (
                  <div className="f9d-ledger">
                    {activity.map((a, i) => (
                      <div className="f9d-ledger__row" key={`${a.label}-${a.date}-${i}`}>
                        <span>
                          <span className="f9d-ledger__label" style={{ display: 'block' }}>
                            {a.label}
                          </span>
                          <span className="f9d-num f9d-ledger__date">{a.date}</span>
                        </span>
                        <span
                          className={`f9d-disp f9d-num f9d-ledger__pts${a.pts.startsWith('-') ? ' f9d-ledger__pts--out' : ''}`}
                          style={{ marginLeft: 'auto' }}
                        >
                          {a.pts}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* ── Femi9 essentials ─────────────────────────────────────────── */}
        <section className="f9d-essentials" aria-labelledby="f9d-ess-h">
          <div className="f9d-essentials__copy">
            <span className="f9d-essentials__glow" aria-hidden="true" />
            <span className="f9d-ey f9d-ey--gold" style={{ position: 'relative' }}>
              Femi9 essentials ✦
            </span>
            <h2 className="f9d-disp f9d-essentials__title" id="f9d-ess-h">
              Stocked up for your <em>next cycle?</em>
            </h2>
            <p className="f9d-essentials__lead">
              Organic cotton, a breathable top sheet, and a refill plan you can pause, skip or cancel whenever your
              month changes shape.
            </p>
            <div className="f9d-essentials__actions">
              <Link className="f9d-btn f9d-btn--gold" to="/shop">
                Shop the range
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <button type="button" className="f9d-btn f9d-btn--light" onClick={goTrack}>
                Track your cycle
              </button>
            </div>
          </div>
          {/* The comp leaves this slot empty, labelled "Product / pack lifestyle
              photo". It first shipped with `hero-lifestyle`, which is 1178x1470
              — PORTRAIT, against a panel that is about 588x389. `cover` then
              threw away 47% of the photo's height, cutting the model's head off
              at the top and slicing the pack in half at the bottom.

              This pack shot is 1346x1169, so the same panel trims about 12% off
              the top and bottom — and that part of the frame is empty cream.
              It is also the photo /account's band already uses in this role, so
              the two member surfaces show the same product. */}
          <div className="f9d-essentials__art" aria-hidden="true">
            <OptImg
              base="figma-home/products-imgFrame206"
              /* The panel is .85 of a 1.15/.85 split inside the wrap, so it is
                 ~42% of the container and never exceeds ~590px. */
              sizes="(max-width: 900px) 100vw, min(42vw, 590px)"
              alt=""
            />
          </div>
        </section>

        {/* The same two sheets /account renders — one implementation, imported
            from @/components/member/sheets, so the OTP challenge on a phone
            change and the address validation cannot drift between the screens. */}
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
      </div>
    </MemberLayout>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   ADDRESS CARD — edit, delete, promote to default, all from this screen
   ══════════════════════════════════════════════════════════════════════════ */

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
    // Always allowed: an address attached to an order is ARCHIVED rather than
    // dropped, so the order's own record survives the delete.
    await mutate(`/api/account/addresses/${address.id}`, { method: 'DELETE' })
    setBusy(false)
    setConfirming(false)
  }

  return (
    <div className="f9d-addr">
      <div className="f9d-addr__top">
        <span className="f9d-addr__tag">{address.primary ? 'Default' : address.label}</span>
        <span className="f9d-addr__acts">
          <button type="button" className="f9d-addr__edit" onClick={onEdit} disabled={busy}>
            Edit
          </button>
          <button
            type="button"
            className="f9d-addr__edit f9d-addr__edit--danger"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-label={`Delete the ${address.label} address`}
          >
            Delete
          </button>
        </span>
      </div>
      <div className="f9d-disp f9d-addr__name">{address.name}</div>
      <p className="f9d-num f9d-addr__lines">
        {address.line}
        <br />
        {address.city}
        {address.phone && (
          <>
            <br />
            {address.phone}
          </>
        )}
      </p>

      {confirming ? (
        <div className="f9d-addr__confirm" role="group" aria-label="Confirm deletion">
          <span>Delete this address?</span>
          <span>
            <button type="button" className="f9d-addr__edit f9d-addr__edit--danger" onClick={() => void remove()} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" className="f9d-addr__edit" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
          </span>
        </div>
      ) : (
        // Unchecking a default would leave the book with none, so the control
        // only exists on the addresses that are NOT the default — you promote a
        // different one instead.
        !address.primary && (
          <button
            type="button"
            className="f9d-addr__default"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await mutate(`/api/account/addresses/${address.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ isPrimary: true }),
              })
              setBusy(false)
            }}
          >
            Make this my default
          </button>
        )
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   SUBSCRIPTION ROW — pause, skip, resume and cancel, all from this screen
   ══════════════════════════════════════════════════════════════════════════ */

function SubscriptionRow({
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
   * Finish a mandate she started and abandoned. Re-fetches the SAME
   * authorization rather than creating a new plan — a second POST to
   * /api/subscriptions leaves her with two plans and two debits a cycle.
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
      notify(SUB_DONE[action])
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const cancelled = sub.status === 'cancelled'

  return (
    <div className="f9d-sub">
      <span className="f9d-order__art" aria-hidden="true">
        <ICycle width={24} height={24} />
      </span>
      <div className="f9d-order__body">
        <div className="f9d-disp f9d-order__no">{sub.product}</div>
        <div className="f9d-num f9d-order__meta">
          {sub.frequency} · {sub.qty} pack{sub.qty === 1 ? '' : 's'}
          {!cancelled && ` · next ${sub.nextDelivery}`}
        </div>

        {error && (
          <p className="f9d-sub__error" role="alert">
            <IAlert width={15} height={15} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {cancelled ? (
          <Link className="f9d-order__again" to="/shop" style={{ display: 'inline-block' }}>
            Subscribe again →
          </Link>
        ) : confirming ? (
          <span className="f9d-sub__acts" role="group" aria-label="Confirm cancellation">
            <span className="f9d-sub__ask">Cancel this plan?</span>
            <button type="button" className="f9d-order__again" onClick={() => void run('cancel')} disabled={busy !== null}>
              {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button type="button" className="f9d-order__again" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Keep it
            </button>
          </span>
        ) : (
          <span className="f9d-sub__acts">
            {/* An unauthorised plan gets ONE action. Falling through to the
                "Resume" branch below offered a control that would ask Razorpay
                to resume a mandate her bank has never approved. `needsMandate`,
                NOT `!mandateActive` — a legacy pay-later plan also has no
                mandate but nothing to authorise. */}
            {sub.needsMandate ? (
              <button
                type="button"
                className="f9d-order__again"
                onClick={() => void finishAuthorization()}
                disabled={authorizing || busy !== null}
              >
                {authorizing ? 'Opening…' : 'Set up auto-pay'}
              </button>
            ) : sub.status === 'active' ? (
              <>
                <button type="button" className="f9d-order__again" onClick={() => void run('pause')} disabled={busy !== null}>
                  {busy === 'pause' ? 'Pausing…' : 'Pause'}
                </button>
                <button type="button" className="f9d-order__again" onClick={() => void run('skip')} disabled={busy !== null}>
                  {busy === 'skip' ? 'Skipping…' : 'Skip next'}
                </button>
              </>
            ) : (
              <button type="button" className="f9d-order__again" onClick={() => void run('resume')} disabled={busy !== null}>
                {busy === 'resume' ? 'Resuming…' : 'Resume'}
              </button>
            )}
            <button
              type="button"
              className="f9d-order__again f9d-order__again--danger"
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
            >
              Cancel plan
            </button>
          </span>
        )}
      </div>
      <div className="f9d-order__end">
        {sub.saved > 0 && !cancelled && (
          <div className="f9d-disp f9d-num f9d-order__total">{fmtRs(sub.saved)}</div>
        )}
        <span className={`f9d-pill${SUB_PILL[sub.status]}`}>{SUB_LABEL[sub.status]}</span>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   CONSENT — asked for, not assumed
   ══════════════════════════════════════════════════════════════════════════ */

function ConsentGate({
  onGranted,
  onDecline,
  notify,
}: {
  onGranted: () => void
  /** Leave the Cycle tab. Nothing is written and nothing is navigated. */
  onDecline: () => void
  notify: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function grant() {
    setBusy(true)
    setError('')
    const res = await callApi('/api/cycle', { method: 'PATCH', body: { consent: true } })
    setBusy(false)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    notify('Cycle tracking is on')
    onGranted()
  }

  return (
    <section className="m-card m-card--roomy dash-consent" aria-labelledby="dash-consent-h">
      <span className="eyebrow">Your data, your call</span>
      <h2 className="m-h2" id="dash-consent-h">
        Turn on cycle tracking
      </h2>
      <p className="m-body">
        Menstrual data is health data, so we do not store any of it until you say yes. Here is exactly what happens
        if you do.
      </p>
      <ul className="dash-consent__list">
        <li>
          <ICheck aria-hidden="true" />
          <span>
            <b>What we keep.</b> The dates your periods started, how long they lasted, and any symptoms and flow you
            choose to log. Nothing else.
          </span>
        </li>
        <li>
          <ICheck aria-hidden="true" />
          <span>
            <b>How it is stored.</b> Encrypted with AES-256-GCM before it touches the database, with its own key per
            entry. The plain dates are never written to a column, and never to a log file.
          </span>
        </li>
        <li>
          <ICheck aria-hidden="true" />
          <span>
            <b>Who sees it.</b> Only you, signed in. It is never shared, never sold, and never used to target you
            with anything.
          </span>
        </li>
        <li>
          <ICheck aria-hidden="true" />
          <span>
            <b>How to stop.</b> Switch tracking off at the bottom of this page at any time. Withdrawing deletes
            every period and symptom you have logged - not just future ones.
          </span>
        </li>
      </ul>
      {error && <FormMessage tone="err">{error}</FormMessage>}
      <div className="m-form__actions">
        <button type="button" className="btn btn-dark" onClick={grant} disabled={busy}>
          {busy ? 'Turning on…' : 'Turn on cycle tracking'}
        </button>
        {/* "Not now" leaves the Cycle tab rather than the page. It used to link
            to /account, which was a whole navigation away from the screen she
            is already on. */}
        <button type="button" className="btn btn-ghost" onClick={onDecline}>
          Not now
        </button>
      </div>
    </section>
  )
}

function CyclePrivacy({ notify, onWithdrawn }: { notify: (m: string) => void; onWithdrawn: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function withdraw() {
    setBusy(true)
    setError('')
    const res = await callApi('/api/cycle', { method: 'PATCH', body: { consent: false } })
    setBusy(false)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    setConfirming(false)
    notify('Cycle tracking is off and your entries are deleted')
    onWithdrawn()
  }

  return (
    <section className="m-card dash-privacy" aria-labelledby="dash-privacy-h">
      <div className="m-card__head">
        <div>
          <h2 className="m-h3" id="dash-privacy-h">
            Cycle data
          </h2>
          <p>Tracking is on. Your entries are encrypted and visible only to you.</p>
        </div>
      </div>
      {error && <FormMessage tone="err">{error}</FormMessage>}
      {confirming ? (
        <div className="m-confirm">
          <span>Turn off tracking and permanently delete every period and symptom you have logged?</span>
          <span className="m-confirm__actions">
            <button type="button" className="m-linkbtn" onClick={withdraw} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete it all'}
            </button>
            <button type="button" className="m-linkbtn" onClick={() => setConfirming(false)} disabled={busy}>
              Keep tracking
            </button>
          </span>
        </div>
      ) : (
        <button type="button" className="m-linkbtn" onClick={() => setConfirming(true)}>
          <ITrash aria-hidden="true" /> Turn off tracking and delete my cycle data
        </button>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   GUEST IMPORT — the dates typed into the landing tracker before signing in
   ══════════════════════════════════════════════════════════════════════════ */

interface GuestTrackerData {
  lastPeriod: string
  cycleLength: number
  periodLength: number
}

function GuestImport({
  clientToday,
  notify,
  onConsentRefused,
}: {
  clientToday: string
  notify: (m: string) => void
  onConsentRefused: () => void
}) {
  const router = useRouter()
  const [guest, setGuest] = useState<GuestTrackerData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Read once on mount: localStorage is client-only, and reading it during
  // render would break hydration.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GUEST_TRACKER_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<GuestTrackerData>
      if (isDayKey(parsed.lastPeriod) && typeof parsed.periodLength === 'number') {
        setGuest({
          lastPeriod: parsed.lastPeriod,
          cycleLength: Number(parsed.cycleLength) || 28,
          periodLength: clampPeriod(parsed.periodLength),
        })
      }
    } catch {
      // Corrupt or blocked storage: there is simply nothing to import.
    }
  }, [])

  const dismiss = useCallback(() => {
    try {
      window.localStorage.removeItem(GUEST_TRACKER_KEY)
    } catch {
      /* storage blocked — dropping the banner is enough */
    }
    setGuest(null)
  }, [])

  if (!guest) return null

  async function importIt() {
    if (!guest) return
    setBusy(true)
    setError('')
    const res = await callApi('/api/cycle/periods', {
      method: 'POST',
      body: { startDate: guest.lastPeriod, lengthDays: guest.periodLength, clientToday },
    })
    setBusy(false)
    if (!res.ok) {
      if (res.error.consentRequired) {
        onConsentRefused()
        return
      }
      setError(res.error.message)
      return
    }
    dismiss()
    notify('Imported from the tracker')
    router.refresh()
  }

  return (
    <section className="m-card dash-import" aria-labelledby="dash-import-h">
      <div className="m-card__head">
        <div>
          <h2 className="m-h3" id="dash-import-h">
            Bring over the dates you entered
          </h2>
          <p>
            You used the tracker on our home page before signing in. Add {fmtFullKey(guest.lastPeriod)} to your
            account so your predictions start from it?
          </p>
        </div>
      </div>
      {error && <FormMessage tone="err">{error}</FormMessage>}
      <div className="m-form__actions">
        <button type="button" className="btn btn-dark" onClick={importIt} disabled={busy}>
          {busy ? 'Importing…' : 'Import these dates'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={dismiss} disabled={busy}>
          No thanks
        </button>
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   PREDICTION RING
   ══════════════════════════════════════════════════════════════════════════ */

function CycleRing({
  cycleDay,
  avgCycle,
  confidence,
}: {
  cycleDay: number
  avgCycle: number
  confidence: number
}) {
  const size = 168
  const stroke = 14
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  // avgCycle is clamped to 21..35 by the service, so this ratio can never be
  // Infinity or NaN the way it could when a duplicate log made avgCycle 0.
  const ratio = Math.min(1, Math.max(0, cycleDay / avgCycle))

  return (
    <div className="dash-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Day ${cycleDay} of about ${avgCycle}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cream-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--yellow)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="dash-ring__label" aria-hidden="true">
        <b>Day {cycleDay}</b>
        <small>of ~{avgCycle}</small>
      </span>
      <span className="m-cap dash-ring__conf">{confidence}% confidence</span>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   CALENDAR — keyboard navigable, and never colour-only
   ══════════════════════════════════════════════════════════════════════════ */

function PhaseCalendar({
  today,
  prediction,
  periods,
  symptoms,
  timezone,
}: {
  today: string
  prediction: CycleData['prediction']
  periods: PeriodEntry[]
  symptoms: SymptomEntry[]
  timezone: string
}) {
  const todayDate = dateFromKey(today)
  const [view, setView] = useState({ y: todayDate.getUTCFullYear(), m: todayDate.getUTCMonth() })
  const [selected, setSelected] = useState(today)
  const gridRef = useRef<HTMLDivElement>(null)
  // Only move focus after a keyboard/button interaction, never on first paint.
  const shouldFocus = useRef(false)

  const phaseOf = useCallback(
    (key: string): CyclePhase =>
      phaseForDayKey(key, {
        nextStart: prediction.nextStart,
        avgCycle: prediction.avgCycle,
        avgPeriod: prediction.avgPeriod,
        periods: periods.map((p) => ({ start: p.start, length: p.length })),
      }),
    [prediction, periods],
  )

  // Day keys for the visible month, plus the leading blanks.
  const { days, leading } = useMemo(() => {
    const firstKey = keyFromDate(new Date(Date.UTC(view.y, view.m, 1)))
    const dayCount = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
    return {
      leading: dateFromKey(firstKey).getUTCDay(),
      days: Array.from({ length: dayCount }, (_, i) => addDaysKey(firstKey, i)),
    }
  }, [view])

  const symptomsByDay = useMemo(() => {
    const map = new Map<string, SymptomEntry[]>()
    for (const s of symptoms) {
      const list = map.get(s.date)
      if (list) list.push(s)
      else map.set(s.date, [s])
    }
    return map
  }, [symptoms])

  // Keep the focused cell reachable after arrow keys move across a month edge.
  useEffect(() => {
    if (!shouldFocus.current) return
    shouldFocus.current = false
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${selected}"]`)
    el?.focus()
  }, [selected, view])

  const goTo = useCallback((key: string) => {
    const d = dateFromKey(key)
    setSelected(key)
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
  }, [])

  const move = (deltaMonths: number) => {
    const d = new Date(Date.UTC(view.y, view.m + deltaMonths, 1))
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
  }

  /** Arrow-key roving focus — the standard date-grid interaction. */
  function onKeyDown(e: React.KeyboardEvent) {
    const jump: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      PageUp: -28,
      PageDown: 28,
    }
    const delta = jump[e.key]
    if (delta === undefined) return
    e.preventDefault()
    shouldFocus.current = true
    goTo(addDaysKey(selected, delta))
  }

  const selectedPhase = phaseOf(selected)
  const selectedSymptoms = symptomsByDay.get(selected) ?? []
  const inView = selected.slice(0, 7) === `${view.y}-${String(view.m + 1).padStart(2, '0')}`

  return (
    <div className="dash-cal">
      <div className="dash-cal__head">
        <button
          type="button"
          className="m-iconbtn dash-cal__nav dash-cal__nav--prev"
          onClick={() => move(-1)}
          aria-label="Previous month"
        >
          <IChevron aria-hidden="true" />
        </button>
        <h3 className="m-h3 dash-cal__title" aria-live="polite">
          {MONTHS[view.m]} {view.y}
        </h3>
        <button type="button" className="m-iconbtn dash-cal__nav" onClick={() => move(1)} aria-label="Next month">
          <IChevron aria-hidden="true" />
        </button>
        <button
          type="button"
          className="m-linkbtn dash-cal__today"
          onClick={() => {
            shouldFocus.current = true
            goTo(today)
          }}
        >
          Today
        </button>
      </div>

      <div className="dash-cal__weekdays" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>

      {/* One tab stop for the whole grid; arrows move within it. */}
      <div className="dash-cal__grid" ref={gridRef} onKeyDown={onKeyDown} role="group" aria-label="Cycle calendar">
        {Array.from({ length: leading }).map((_, i) => (
          <span key={`pad-${i}`} className="dash-cal__pad" />
        ))}
        {days.map((key) => {
          const phase = phaseOf(key)
          const isToday = key === today
          const isSelected = key === selected
          const hasSymptoms = symptomsByDay.has(key)
          const phaseName = phase ? PHASE_LABEL[phase] : 'nothing predicted'
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              data-phase={phase ?? 'none'}
              className={`dash-cal__day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
              // Roving tabindex: only the selected day is in the tab order, so
              // the calendar costs one tab stop rather than thirty-one.
              tabIndex={isSelected || (!inView && key === days[0]) ? 0 : -1}
              aria-pressed={isSelected}
              aria-label={`${fmtFullKey(key)} - ${phaseName}${hasSymptoms ? ', symptoms logged' : ''}${isToday ? ', today' : ''}`}
              onClick={() => setSelected(key)}
              onFocus={() => setSelected(key)}
            >
              <span className="dash-cal__num">{dateFromKey(key).getUTCDate()}</span>
              {/* A shape, not just a hue — the phase must survive colour blindness
                  and a monochrome print. Each phase gets its own marker in CSS. */}
              {phase && <span className="dash-cal__mark" aria-hidden="true" />}
              {hasSymptoms && <span className="dash-cal__symp" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      {/* Selected-day detail. Reachable by tap and keyboard, not only by hover. */}
      <div className="dash-cal__detail" role="status">
        <b>{fmtFullKey(selected)}</b>
        <span>
          {selectedPhase ? `${PHASE_LABEL[selectedPhase]} - ${PHASE_HINT[selectedPhase]}` : 'Nothing predicted for this day.'}
        </span>
        {selectedSymptoms.length > 0 && (
          <span>
            Logged: {selectedSymptoms.map((s) => `${s.day} (${levelLabel(s.day, s.level)})`).join(', ')}
          </span>
        )}
        {selectedSymptoms.find((s) => s.note) && (
          <span className="dash-log__note">“{selectedSymptoms.find((s) => s.note)?.note}”</span>
        )}
      </div>

      <ul className="dash-cal__legend">
        {(Object.keys(PHASE_LABEL) as Exclude<CyclePhase, null>[]).map((p) => (
          <li key={p} data-phase={p}>
            <span className="dash-cal__swatch" aria-hidden="true" />
            <span>
              <b>{PHASE_LABEL[p]}</b>
              <small>{PHASE_HINT[p]}</small>
            </span>
          </li>
        ))}
        <li data-phase="symptom">
          <span className="dash-cal__swatch" aria-hidden="true" />
          <span>
            <b>Symptoms logged</b>
            <small>A day you recorded how you felt.</small>
          </span>
        </li>
      </ul>
      <p className="m-cap">
        Dates are shown in {timezone.replace('_', ' ')}. Use the arrow keys to move day by day.
      </p>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   TREND — measured gaps only, drawn as labelled bars so the numbers are legible
   ══════════════════════════════════════════════════════════════════════════ */

function TrendBars({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  return (
    // The summary used to be a sibling <li> of the bars inside one grid, relying
    // on `grid-column: 1 / -1` to span — which cannot work when every track is
    // implicit, so the sentence was squeezed into bar column 1 and painted
    // outside the card. It is now a sibling of the bar list instead.
    <div className="dash-trend">
      <ul className="dash-trend__bars">
        {values.map((v, i) => (
          <li key={`${labels[i]}-${i}`} className="dash-trend__item">
            <span className="dash-trend__bar" style={{ height: `${Math.round((v / max) * 100)}%` }} aria-hidden="true" />
            <span className="dash-trend__value m-num">{v}</span>
            <span className="dash-trend__label">{labels[i]}</span>
          </li>
        ))}
      </ul>
      <p className="dash-trend__summary m-cap">
        {min === max ? `Every measured cycle was ${max} days.` : `Between ${min} and ${max} days.`}
      </p>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   PERIOD FORM
   ══════════════════════════════════════════════════════════════════════════ */

function PeriodForm({
  maxDate,
  defaultLength,
  clientToday,
  onSaved,
  onConsentRefused,
  notify,
}: {
  maxDate: string
  defaultLength: number
  clientToday: string
  onSaved: () => void
  onConsentRefused: () => void
  notify: (m: string) => void
}) {
  const [startDate, setStartDate] = useState('')
  const [lengthDays, setLengthDays] = useState(clampPeriod(defaultLength))
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (!isDayKey(startDate)) {
      setFieldError('Pick the day your period started.')
      return
    }
    if (daysBetweenKeys(clientToday, startDate) > 0) {
      setFieldError('That day has not happened yet. Pick when your period actually started.')
      return
    }
    setFieldError('')
    setBusy(true)
    const res = await callApi<{ deduped?: boolean }>('/api/cycle/periods', {
      method: 'POST',
      body: { startDate, lengthDays, clientToday },
    })
    setBusy(false)

    if (!res.ok) {
      if (res.error.consentRequired) {
        onConsentRefused()
        return
      }
      setMessage({ tone: 'err', text: res.error.message })
      return
    }
    setStartDate('')
    setMessage({
      tone: 'ok',
      text: res.data.deduped
        ? 'Updated that day. Your predictions have been recalculated.'
        : 'Period logged. Your predictions have been recalculated.',
    })
    notify('Period logged')
    onSaved()
  }

  return (
    <form className="m-form" onSubmit={submit} noValidate>
      <div className="m-form__grid">
        <div className="m-field">
          <label className="m-field__label" htmlFor="dash-start">
            When did it start?
          </label>
          <input
            id="dash-start"
            className="m-input"
            type="date"
            value={startDate}
            max={maxDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              if (fieldError) setFieldError('')
            }}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? 'dash-start-err' : undefined}
            required
          />
          {fieldError && (
            <p className="m-field__error" id="dash-start-err">
              <IAlert aria-hidden="true" />
              {fieldError}
            </p>
          )}
        </div>

        <div className="m-field">
          <label className="m-field__label" htmlFor="dash-len">
            How many days did it last?
          </label>
          <input
            id="dash-len"
            className="m-input"
            type="number"
            min={1}
            max={15}
            value={lengthDays}
            onChange={(e) => setLengthDays(clampPeriod(Number(e.target.value)))}
          />
          <span className="m-field__hint">Between 1 and 15 days.</span>
        </div>
      </div>

      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

      <div className="m-form__actions">
        <button type="submit" className="btn btn-dark btn--block" disabled={busy}>
          {busy ? 'Saving…' : 'Log this period'}
        </button>
      </div>
    </form>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   SYMPTOM FORM — multi-select, dated, with a flow scale and per-symptom intensity
   ══════════════════════════════════════════════════════════════════════════ */

function SymptomForm({
  maxDate,
  clientToday,
  onSaved,
  onConsentRefused,
  notify,
}: {
  maxDate: string
  clientToday: string
  onSaved: () => void
  onConsentRefused: () => void
  notify: (m: string) => void
}) {
  // Defaults to the USER's today (from their browser), not the server's UTC day.
  const [date, setDate] = useState(clientToday)
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [flow, setFlow] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const toggle = (symptom: string) =>
    setPicked((prev) => {
      const next = { ...prev }
      if (symptom in next) delete next[symptom]
      else next[symptom] = 2 // "Moderate" is the honest default to nudge from
      return next
    })

  const setLevel = (symptom: string, level: number) => setPicked((prev) => ({ ...prev, [symptom]: level }))

  const chosen = Object.keys(picked)
  const nothingToSave = chosen.length === 0 && flow === null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (nothingToSave) {
      setMessage({ tone: 'err', text: 'Pick at least one symptom, or set your flow.' })
      return
    }
    setBusy(true)

    // The whole day goes in one request. Cramps AND low energy AND poor sleep is
    // one afternoon, not three visits to a form — the endpoint stores a row per
    // symptom so each stays independently deletable, but the user submits once.
    const entries: { symptom: string; level: number }[] = chosen.map((s) => ({ symptom: s, level: picked[s] }))
    if (flow !== null) entries.push({ symptom: FLOW_SYMPTOM, level: flow })

    const res = await callApi('/api/cycle/symptoms', {
      method: 'POST',
      body: { date, entries, note: note.trim() || undefined, clientToday },
    })
    setBusy(false)

    if (!res.ok) {
      if (res.error.consentRequired) {
        onConsentRefused()
        return
      }
      setMessage({ tone: 'err', text: res.error.message })
      return
    }
    setPicked({})
    setFlow(null)
    setNote('')
    setMessage({ tone: 'ok', text: `Logged for ${fmtFullKey(date)}.` })
    notify('Entry saved')
    onSaved()
  }

  return (
    <form className="m-form" onSubmit={submit} noValidate>
      <div className="m-field">
        <label className="m-field__label" htmlFor="dash-sdate">
          Which day?
        </label>
        <input
          id="dash-sdate"
          className="m-input"
          type="date"
          value={date}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <fieldset className="dash-fieldset">
        <legend className="m-field__label">
          Flow <span>(optional)</span>
        </legend>
        <div className="dash-chips">
          {FLOW_LEVELS.map((label, i) => (
            <Chip key={label} selected={flow === i} onClick={() => setFlow(flow === i ? null : i)}>
              {label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="dash-fieldset">
        <legend className="m-field__label">
          Symptoms <span>(pick any)</span>
        </legend>
        <div className="dash-chips">
          {SYMPTOMS.map((s) => (
            <Chip key={s} selected={s in picked} onClick={() => toggle(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </fieldset>

      {chosen.length > 0 && (
        <ul className="dash-levels">
          {chosen.map((s) => (
            <li key={s} className="dash-levels__row">
              <span className="dash-levels__name">{s}</span>
              <span className="seg" role="group" aria-label={`How strong was ${s.toLowerCase()}?`}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={picked[s] === n ? 'on' : ''}
                    aria-pressed={picked[s] === n}
                    onClick={() => setLevel(s, n)}
                  >
                    {INTENSITY_LEVELS[n]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="m-field">
        <label className="m-field__label" htmlFor="dash-note">
          Anything else? <span>(optional)</span>
        </label>
        <textarea
          id="dash-note"
          className="m-textarea"
          value={note}
          maxLength={500}
          rows={3}
          placeholder="Slept badly, cramps eased after a hot pack…"
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="m-field__hint">Kept with the day, encrypted like everything else here.</span>
      </div>

      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

      <div className="m-form__actions">
        <button type="submit" className="btn btn-ghost btn--block" disabled={busy || nothingToSave}>
          {busy ? 'Saving…' : 'Save this entry'}
        </button>
      </div>
    </form>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   LOGGED HISTORY — edit and delete, because a typo poisons every prediction
   ══════════════════════════════════════════════════════════════════════════ */

function PeriodHistory({
  periods,
  maxDate,
  clientToday,
  onChanged,
  onConsentRefused,
  notify,
}: {
  periods: PeriodEntry[]
  maxDate: string
  clientToday: string
  onChanged: () => void
  onConsentRefused: () => void
  notify: (m: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [draftStart, setDraftStart] = useState('')
  const [draftLength, setDraftLength] = useState(5)

  function openEdit(p: PeriodEntry) {
    setConfirming(null)
    setError('')
    setEditing(p.id)
    setDraftStart(p.start)
    setDraftLength(p.length)
  }

  /**
   * Save a correction in place. PATCH re-encrypts the payload and re-keys the
   * day hash server-side, so moving a start onto a day that already has a row
   * folds the two together instead of leaving a duplicate behind.
   */
  async function saveEdit(original: PeriodEntry) {
    if (!isDayKey(draftStart)) {
      setError('Pick a valid start date.')
      return
    }
    if (daysBetweenKeys(clientToday, draftStart) > 0) {
      setError('That day has not happened yet.')
      return
    }
    setBusy(true)
    setError('')

    const res = await callApi('/api/cycle/periods', {
      method: 'PATCH',
      body: { id: original.id, startDate: draftStart, lengthDays: draftLength, clientToday },
    })
    setBusy(false)

    if (!res.ok) {
      if (res.error.consentRequired) {
        onConsentRefused()
        return
      }
      setError(res.error.message)
      return
    }
    setEditing(null)
    notify('Period updated')
    onChanged()
  }

  async function remove(id: string) {
    setBusy(true)
    setError('')
    const res = await callApi(`/api/cycle/periods?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    setConfirming(null)
    notify('Period removed')
    onChanged()
  }

  if (periods.length === 0) {
    return (
      <div className="m-empty">
        <span className="m-empty__art">
          <ICycle aria-hidden="true" />
        </span>
        <h3 className="m-h3">Nothing logged yet</h3>
        <p>Log a period on the left and it will appear here, ready to edit if you mistype a date.</p>
      </div>
    )
  }

  return (
    <>
      {error && <FormMessage tone="err">{error}</FormMessage>}
      <ul className="dash-log">
        {periods.map((p) => (
          <li key={p.id} className="dash-log__item">
            {editing === p.id ? (
              <div className="m-form dash-log__edit">
                <div className="m-form__grid">
                  <div className="m-field">
                    <label className="m-field__label" htmlFor={`edit-start-${p.id}`}>
                      Start date
                    </label>
                    <input
                      id={`edit-start-${p.id}`}
                      className="m-input"
                      type="date"
                      value={draftStart}
                      max={maxDate}
                      onChange={(e) => setDraftStart(e.target.value)}
                    />
                  </div>
                  <div className="m-field">
                    <label className="m-field__label" htmlFor={`edit-len-${p.id}`}>
                      Days
                    </label>
                    <input
                      id={`edit-len-${p.id}`}
                      className="m-input"
                      type="number"
                      min={1}
                      max={15}
                      value={draftLength}
                      onChange={(e) => setDraftLength(clampPeriod(Number(e.target.value)))}
                    />
                  </div>
                </div>
                <div className="m-form__actions">
                  <button type="button" className="btn btn-dark" onClick={() => saveEdit(p)} disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : confirming === p.id ? (
              <div className="m-confirm">
                <span>Remove the period starting {p.startLabel}?</span>
                <span className="m-confirm__actions">
                  <button type="button" className="m-linkbtn" onClick={() => remove(p.id)} disabled={busy}>
                    {busy ? 'Removing…' : 'Yes, remove'}
                  </button>
                  <button type="button" className="m-linkbtn" onClick={() => setConfirming(null)} disabled={busy}>
                    Keep it
                  </button>
                </span>
              </div>
            ) : (
              <>
                <span className="dash-log__main">
                  <span className="m-row__title">{p.startLabel}</span>
                  <span className="m-row__meta">
                    Lasted {p.length} day{p.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="dash-log__actions">
                  <button
                    type="button"
                    className="m-iconbtn"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit the period starting ${p.startLabel}`}
                  >
                    <IPencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="m-iconbtn m-iconbtn--danger"
                    onClick={() => {
                      setEditing(null)
                      setConfirming(p.id)
                    }}
                    aria-label={`Remove the period starting ${p.startLabel}`}
                  >
                    <ITrash aria-hidden="true" />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function SymptomHistory({
  entries,
  onChanged,
  notify,
}: {
  entries: SymptomEntry[]
  onChanged: () => void
  notify: (m: string) => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function remove(id: string) {
    setBusy(true)
    setError('')
    const res = await callApi(`/api/cycle/symptoms?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    setConfirming(null)
    notify('Entry removed')
    onChanged()
  }

  if (entries.length === 0) {
    return (
      <div className="m-empty">
        <span className="m-empty__art">
          <ISparkles aria-hidden="true" />
        </span>
        <h3 className="m-h3">Nothing logged yet</h3>
        <p>Record cramps, mood or flow and your patterns start showing up across the calendar.</p>
      </div>
    )
  }

  // Two honest groups instead of one heading that claimed six-month-old entries
  // were from "this cycle".
  const thisCycle = entries.filter((e) => e.inCurrentCycle)
  const earlier = entries.filter((e) => !e.inCurrentCycle)

  const row = (e: SymptomEntry) => (
    <li key={e.id} className="dash-log__item">
      {confirming === e.id ? (
        <div className="m-confirm">
          <span>
            Remove {e.day.toLowerCase()} logged on {fmtDayMonth(e.date)}?
          </span>
          <span className="m-confirm__actions">
            <button type="button" className="m-linkbtn" onClick={() => remove(e.id)} disabled={busy}>
              {busy ? 'Removing…' : 'Yes, remove'}
            </button>
            <button type="button" className="m-linkbtn" onClick={() => setConfirming(null)} disabled={busy}>
              Keep it
            </button>
          </span>
        </div>
      ) : (
        <>
          <span className="dash-log__main">
            <span className="m-row__title">{e.day}</span>
            <span className="m-row__meta">
              {fmtDayMonth(e.date)} · {levelLabel(e.day, e.level)}
            </span>
            {e.note && <span className="m-row__meta dash-log__note">“{e.note}”</span>}
          </span>
          <span className="dash-log__actions">
            {/* The level as dots is decorative; the word above carries the meaning. */}
            <span className="dash-dots" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span key={n} className={n <= e.level ? 'on' : ''} />
              ))}
            </span>
            <button
              type="button"
              className="m-iconbtn m-iconbtn--danger"
              onClick={() => setConfirming(e.id)}
              aria-label={`Remove ${e.day} logged on ${fmtDayMonth(e.date)}`}
            >
              <ITrash aria-hidden="true" />
            </button>
          </span>
        </>
      )}
    </li>
  )

  return (
    <>
      {error && <FormMessage tone="err">{error}</FormMessage>}
      {thisCycle.length > 0 && (
        <>
          <p className="m-cap">This cycle</p>
          <ul className="dash-log">{thisCycle.map(row)}</ul>
        </>
      )}
      {earlier.length > 0 && (
        <>
          <p className="m-cap">Earlier</p>
          <ul className="dash-log">{earlier.map(row)}</ul>
        </>
      )}
    </>
  )
}

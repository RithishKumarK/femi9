import '../styles/cycle-tracker.css'
import { useMemo, useState } from 'react'
import { Link } from '@/lib/router-compat'
import { useRouter } from 'next/navigation'
import {
  CYCLE_MAX,
  CYCLE_MIN,
  DEFAULT_CYCLE,
  PHASE_LABEL,
  addDaysKey,
  clampCycle,
  dateFromKey,
  daysBetweenKeys,
  isDayKey,
  localDayKey,
  phaseForDayKey,
  predictFromLastStart,
  type CyclePhase,
} from '@femi9/core/cycle-math'

/* ------------------------------------------------------------------ *
 * Femi9 · Cycle tracker (homepage section #10)
 *
 * Two states: SETUP and RESULT. The prediction is computed locally so a
 * signed-out visitor gets an instant answer, and the SAME `@/lib/cycle-math`
 * module the dashboard and the cycle service use does the arithmetic — this
 * file used to carry a third, drifted copy that put the fertile window a day
 * off from the calendar it was meant to agree with.
 *
 * Two behaviours this section previously got wrong, both fixed here:
 *  1. It POSTed and then did `if (res.ok) router.refresh()` with NO else, while
 *     the copy beside it said the dates were "saved to your account". A 400 or a
 *     401 was swallowed. Every outcome now has its own visible state.
 *  2. A signed-out visitor's answers were thrown away on navigation, so after
 *     signing up she was asked for them all over again. They are now kept in
 *     localStorage and offered as a one-click import on the dashboard.
 * ------------------------------------------------------------------ */

const PERIOD_MIN = 3
const PERIOD_MAX = 8
const PERIOD_DEFAULT = 5

/** Shared with the dashboard's import card. Keep the two in step. */
const GUEST_TRACKER_KEY = 'femi9.cycle.guest'

type TrackerData = {
  lastPeriod: string // 'YYYY-MM-DD'
  cycleLength: number
  periodLength: number
}

/** Phase colours, paired with a text label everywhere they appear. */
const PHASE_COLOR: Record<Exclude<CyclePhase, null>, { color: string; tint: string }> = {
  period: { color: '#C85C79', tint: 'rgba(200,92,121,.16)' },
  predicted: { color: '#E4A9B8', tint: 'rgba(228,169,184,.22)' },
  fertile: { color: '#7FD0C8', tint: 'rgba(127,208,200,.24)' },
  ovulation: { color: '#0E9E94', tint: 'rgba(14,158,148,.16)' },
  pms: { color: '#E7B85C', tint: 'rgba(231,184,92,.24)' },
}
/** A day with no predicted phase still needs a swatch and a name. */
const NEUTRAL = { color: '#B79BD8', tint: 'rgba(183,155,216,.18)' }
const phaseColor = (p: CyclePhase) => (p ? PHASE_COLOR[p] : NEUTRAL)
const phaseName = (p: CyclePhase) => (p ? PHASE_LABEL[p] : 'Between phases')

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const clampPeriodInput = (n: unknown) => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return PERIOD_DEFAULT
  return Math.min(PERIOD_MAX, Math.max(PERIOD_MIN, v))
}

const fmtDayKey = (key: string) =>
  dateFromKey(key).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' })

/**
 * What happened when we tried to put this on the visitor's account.
 * `guest` is not a failure — it is the expected state for a signed-out visitor,
 * and it earns an invitation rather than an error.
 */
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'guest' }
  | { kind: 'consent' }
  | { kind: 'error'; message: string }

/* ---------- stepper subcomponent ---------- */
function Stepper({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (n: number) => void
}) {
  const dec = () => onChange(Math.max(min, value - 1))
  const inc = () => onChange(Math.min(max, value + 1))
  return (
    <div className="cyc-field">
      <span className="cyc-label">
        {label}
        {hint && <em className="cyc-hint"> {hint}</em>}
      </span>
      <div className="cyc-stepper" role="group" aria-label={label}>
        <button
          type="button"
          className="cyc-step-btn"
          onClick={inc}
          disabled={value >= max}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <span aria-hidden="true">+</span>
        </button>
        <span className="cyc-step-val" aria-live="polite">
          <b>{value}</b>
          <small>{unit}</small>
        </span>
        <button
          type="button"
          className="cyc-step-btn"
          onClick={dec}
          disabled={value <= min}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <span aria-hidden="true">–</span>
        </button>
      </div>
    </div>
  )
}

/* ================================================================== */
export function CycleTracker() {
  // The visitor's OWN calendar day. `new Date().toISOString()` would be the UTC
  // day, which in IST is yesterday until 05:30 — the exact reason the API used
  // to reject a perfectly valid "my period started today".
  const todayKey = useMemo(() => localDayKey(), [])

  const router = useRouter()
  const [data, setData] = useState<TrackerData | null>(null)
  const [mode, setMode] = useState<'setup' | 'result'>('setup')
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })

  // form state
  const [lastPeriod, setLastPeriod] = useState('')
  const [cycleLength, setCycleLength] = useState(DEFAULT_CYCLE)
  const [periodLength, setPeriodLength] = useState(PERIOD_DEFAULT)
  const [error, setError] = useState('')

  const prediction = useMemo(
    () =>
      data && mode === 'result'
        ? predictFromLastStart(data.lastPeriod, todayKey, data.cycleLength, data.periodLength)
        : null,
    [data, mode, todayKey],
  )

  /**
   * Try to attach these dates to the signed-in account.
   *
   * Extracted so the error state can offer a real retry rather than making the
   * visitor re-enter everything.
   */
  async function persist(next: TrackerData) {
    setSave({ kind: 'saving' })
    let res: Response
    try {
      res = await fetch('/api/cycle/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: next.lastPeriod,
          lengthDays: next.periodLength,
          cycleLength: next.cycleLength,
          clientToday: todayKey,
        }),
      })
    } catch {
      setSave({ kind: 'error', message: 'We could not reach Femi9 just now.' })
      return
    }

    if (res.ok) {
      setSave({ kind: 'saved' })
      // It lives on the account now, so the guest copy has done its job.
      try {
        window.localStorage.removeItem(GUEST_TRACKER_KEY)
      } catch {
        /* storage blocked — nothing to clean up */
      }
      router.refresh()
      return
    }
    if (res.status === 401) {
      setSave({ kind: 'guest' })
      return
    }
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
    if (res.status === 403 || body?.code === 'consent_required') {
      setSave({ kind: 'consent' })
      return
    }
    setSave({
      kind: 'error',
      message: typeof body?.error === 'string' ? body.error : 'We could not save this to your account.',
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isDayKey(lastPeriod)) {
      setError('Please pick the date your last period started.')
      return
    }
    if (daysBetweenKeys(todayKey, lastPeriod) > 0) {
      setError('That date is in the future. Pick when your last period actually started.')
      return
    }

    // Show the local result immediately — the prediction card is computed
    // client-side, so a signed-out visitor still gets her answer.
    const next: TrackerData = {
      lastPeriod,
      cycleLength: clampCycle(cycleLength),
      periodLength: clampPeriodInput(periodLength),
    }
    setData(next)
    setError('')
    setMode('result')

    // Keep it locally either way: a visitor who signs up next is offered a
    // one-click import on her dashboard instead of being asked all over again.
    try {
      window.localStorage.setItem(GUEST_TRACKER_KEY, JSON.stringify(next))
    } catch {
      /* private mode / storage full — the on-screen prediction still stands */
    }

    await persist(next)
  }

  const handleEdit = () => {
    if (data) {
      setLastPeriod(data.lastPeriod)
      setCycleLength(data.cycleLength)
      setPeriodLength(data.periodLength)
    }
    setError('')
    setSave({ kind: 'idle' })
    setMode('setup')
  }

  // 7-day strip starting today (result state only)
  const week = useMemo(() => {
    if (!data || !prediction) return []
    return Array.from({ length: 7 }, (_, i) => {
      const key = addDaysKey(todayKey, i)
      return {
        key,
        label: WEEKDAYS[dateFromKey(key).getUTCDay()],
        num: dateFromKey(key).getUTCDate(),
        isToday: i === 0,
        phase: phaseForDayKey(key, {
          nextStart: prediction.nextStart,
          avgCycle: prediction.cycleLength,
          avgPeriod: prediction.periodLength,
          periods: [{ start: prediction.cycleStart, length: prediction.periodLength }],
        }),
      }
    })
  }, [data, prediction, todayKey])

  // Phases present in the week, in a stable legend order.
  const legendPhases = useMemo(() => {
    const order: CyclePhase[] = ['period', 'predicted', 'fertile', 'ovulation', 'pms', null]
    const present = new Set(week.map((d) => d.phase))
    return order.filter((p) => present.has(p))
  }, [week])

  return (
    <section id="tracker" className="section cyc" aria-labelledby="cyc-heading">
      {/* Decorative only, and display:none below 900px (figma-landing-responsive.css)
          where the section goes height:auto and the percentage boxes stretch a
          round blob into a 6x vertical streak. `loading="lazy"` means a phone
          does not fetch them at all. */}
      <div className="cyc-fig-vectors" aria-hidden="true">
        <img data-node-id="198:2531" src="/assets/figma-home/tracker-imgVector.svg" alt="" width={1508} height={700} loading="lazy" decoding="async" />
        <img data-node-id="198:2540" src="/assets/figma-home/tracker-imgVector1.svg" alt="" width={554} height={557} loading="lazy" decoding="async" />
        <img data-node-id="198:2549" src="/assets/figma-home/tracker-imgVector2.svg" alt="" width={518} height={381} loading="lazy" decoding="async" />
        <img data-node-id="198:2558" src="/assets/figma-home/tracker-imgVector3.svg" alt="" width={140} height={151} loading="lazy" decoding="async" />
      </div>
      <div className="wrap">
        <div className={`cyc-panel${mode === 'result' ? ' is-result' : ''}`}>
          {/* ---- intro / copy side ---- */}
          <div className="cyc-intro">
            <h2 id="cyc-heading" className="display">
              Know Your Cycle.<br />
              Plan Your Period With Confidence.
            </h2>
            {/* The lead no longer asserts that anything was saved — the status
                line under the result says what actually happened. */}
            <p className="cyc-lead">
              {mode === 'setup'
                ? 'A gentle, private tracker. Tell us three things to see when your next period is likely to arrive - and if you are signed in with cycle tracking on, we will keep it with your account.'
                : 'Here is your rhythm at a glance, so you can plan your days and your Femi9 pack with a little more calm.'}
            </p>
            <ul className="cyc-assurances" aria-label="How this tracker treats your data">
              <li>100% Organic Cotton</li>
              <li>Biodegradable Materials</li>
            </ul>
          </div>

          {/* ---- interactive side ---- */}
          {mode === 'setup' ? (
            <form className="cyc-card cyc-setup" onSubmit={handleSubmit} noValidate>
              <div className="cyc-form-title">
                <h3>Calculate Your Next Period</h3>
                <p>Three answers, and your next date is on screen. No account needed to see it.</p>
              </div>
              <div className="cyc-field">
                <label className="cyc-label" htmlFor="cyc-date">
                  Last Period Date
                </label>
                <input
                  id="cyc-date"
                  className="cyc-date"
                  type="date"
                  value={lastPeriod}
                  max={todayKey}
                  onChange={(e) => {
                    setLastPeriod(e.target.value)
                    if (error) setError('')
                  }}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'cyc-error' : undefined}
                  required
                />
              </div>

              <Stepper
                label="Cycle length"
                hint="days between periods"
                value={cycleLength}
                min={CYCLE_MIN}
                max={CYCLE_MAX}
                unit="days"
                onChange={setCycleLength}
              />

              <Stepper
                label="Period length"
                hint="optional"
                value={periodLength}
                min={PERIOD_MIN}
                max={PERIOD_MAX}
                unit="days"
                onChange={setPeriodLength}
              />

              {error && (
                <p className="cyc-error" id="cyc-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn-primary cyc-submit">
                Show Prediction
              </button>
              <p className="cyc-fineprint">Averages are a guide. Every body keeps its own time.</p>
            </form>
          ) : (
            prediction && (
              <div className="cyc-card cyc-result" aria-live="polite">
                <span className="cyc-blob" aria-hidden="true" />

                <div className="cyc-headline">
                  <p className="cyc-eyebrow-sm">Your next period</p>
                  <p className="cyc-big display">
                    Next period in <span className="cyc-count">{prediction.daysUntilNext}</span>{' '}
                    {prediction.daysUntilNext === 1 ? 'day' : 'days'}
                  </p>
                  <p className="cyc-sub">
                    Around {fmtDayKey(prediction.nextStart)} · Cycle day {prediction.cycleDay}
                  </p>
                </div>

                <div
                  className="cyc-phase"
                  style={{ '--pc': phaseColor(prediction.phase).color } as React.CSSProperties}
                >
                  <span className="cyc-phase-dot" aria-hidden="true" />
                  <span className="cyc-phase-text">
                    <b>Today: {phaseName(prediction.phase)}</b>
                    <small>
                      Day {prediction.cycleDay} of a ~{prediction.cycleLength}-day cycle
                    </small>
                  </span>
                </div>

                {/* week strip */}
                <div className="cyc-week" role="group" aria-label="The next seven days">
                  {week.map((d) => {
                    const meta = phaseColor(d.phase)
                    const name = phaseName(d.phase)
                    return (
                      <div
                        key={d.key}
                        className={`cyc-day${d.isToday ? ' is-today' : ''}`}
                        style={{ '--pc': meta.color, '--pt': meta.tint } as React.CSSProperties}
                      >
                        <span className="cyc-day-wd">{d.label}</span>
                        <span className="cyc-day-num">{d.num}</span>
                        <span className="cyc-day-dot" aria-hidden="true" />
                        {/* The phase name used to live only in a `title`
                            tooltip, which never fires on touch: a phone showed
                            seven coloured squares and asked the reader to match
                            11px legend swatches by colour. It is rendered for
                            real below 480px and stays sr-only above it. */}
                        <span className="cyc-day-phase" aria-hidden="true">{name}</span>
                        <span className="visually-hidden">
                          {fmtDayKey(d.key)}: {name}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <div className="cyc-legend">
                  {legendPhases.map((p) => (
                    <span key={p ?? 'none'} className="cyc-legend-item">
                      <span className="cyc-legend-sw" style={{ background: phaseColor(p).color }} />
                      {phaseName(p)}
                    </span>
                  ))}
                </div>

                {/* What actually happened to the visitor's data. Never a claim
                    that outran the response. */}
                <SaveStatus state={save} onRetry={() => data && persist(data)} />

                {/* product tie-in */}
                <div className="cyc-tiein">
                  <p>
                    Your Femi9 pack can arrive <b>~3 days before</b>, so you never get caught out.
                  </p>
                  <Link to="/shop" className="btn btn-primary cyc-tiein-btn">
                    Subscribe &amp; save
                  </Link>
                </div>

                <button type="button" className="cyc-edit" onClick={handleEdit}>
                  Update my dates
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  )
}

/** The one place the tracker tells the visitor where her data went. */
function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === 'idle') return null

  if (state.kind === 'saving') {
    return (
      <p className="cyc-save" role="status">
        Saving to your account…
      </p>
    )
  }
  if (state.kind === 'saved') {
    return (
      <p className="cyc-save cyc-save--ok" role="status">
        Saved to your Femi9 account.{' '}
        <Link to="/dashboard" className="cyc-save-link">
          Open your dashboard
        </Link>
      </p>
    )
  }
  if (state.kind === 'guest') {
    return (
      <p className="cyc-save" role="status">
        This prediction is showing on this device only.{' '}
        <Link to="/login?next=/dashboard" className="cyc-save-link">
          Sign in to save it to your account
        </Link>{' '}
        - we will offer to bring these dates across.
      </p>
    )
  }
  if (state.kind === 'consent') {
    return (
      <p className="cyc-save" role="status">
        We did not store this. Cycle data is only kept once you turn tracking on.{' '}
        <Link to="/dashboard" className="cyc-save-link">
          Turn on cycle tracking
        </Link>
      </p>
    )
  }
  return (
    <p className="cyc-save cyc-save--err" role="alert">
      {state.message} Your prediction above still stands, but it was not saved.{' '}
      <button type="button" className="cyc-save-link" onClick={onRetry}>
        Try again
      </button>
    </p>
  )
}

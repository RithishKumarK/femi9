/**
 * Cycle math — the ONE implementation of phase/prediction arithmetic.
 *
 * Before this module there were three copies: the server-only `getPhase` in
 * services/cycle.ts, a `makeGetPhase` mirror inside UserDashboard, and a third
 * `phaseForCycleDay`/`phaseForDate` pair inside the landing CycleTracker. They
 * had already drifted — the landing put the fertile window at ovulation-4 while
 * the dashboard used ovulation-5, and the "advertised" fertile end (ovulation+1)
 * was a day longer than either painter would colour. Two surfaces predicting
 * different dates for the same person is the bug this file exists to kill.
 *
 * Deliberately NOT 'server-only': the landing tracker, the dashboard and the
 * service all import it. It touches no Prisma, no crypto and no env.
 *
 * DATE REPRESENTATION. Every date crossing a boundary is a plain `YYYY-MM-DD`
 * day key. Internally the arithmetic runs on UTC-midnight `Date`s, because
 * adding days to a UTC midnight can never be nudged across a day boundary by a
 * DST transition the way a local-midnight Date can. A key round-trips to the
 * same calendar day regardless of where the process or the browser lives.
 * The single place we deliberately read LOCAL wall-clock time is `localDayKey`,
 * which answers "what day is it for THIS user right now" — the question the
 * server got wrong by asking UTC.
 */

const DAY = 86_400_000

/** Clinically sane bounds. Anything outside is a typo or a corrupted average. */
export const CYCLE_MIN = 21
export const CYCLE_MAX = 35
export const DEFAULT_CYCLE = 28
export const PERIOD_MIN = 1
export const PERIOD_MAX = 15
export const DEFAULT_PERIOD = 5

/** Days from a period start back to ovulation. The luteal phase is the stable half. */
export const LUTEAL_DAYS = 14
/** Fertile window, expressed as offsets from ovulation. ONE definition, shared. */
export const FERTILE_BEFORE = 5
export const FERTILE_AFTER = 1
/** PMS window, expressed as days before the next start. */
export const PMS_DAYS = 5

export type CyclePhase = 'period' | 'predicted' | 'fertile' | 'ovulation' | 'pms' | null

// ── Day-key helpers ──────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → UTC-midnight Date. Tolerates a full ISO datetime. */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** UTC-midnight Date → `YYYY-MM-DD`. */
export function keyFromDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The day key for a date read in LOCAL wall-clock terms. This is how a browser
 * answers "what is today for me", and the only correct source for a client's
 * `clientToday`. `new Date().toISOString().slice(0,10)` is NOT this — in IST it
 * returns yesterday between 00:00 and 05:30, which is exactly why the API used
 * to reject a user's real today as "in the future".
 */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The day key for "now" in a named IANA zone. `en-CA` is the locale whose short
 * date format is already `YYYY-MM-DD`, so no part re-assembly is needed.
 * Falls back to UTC if the runtime rejects the zone (never throws).
 */
export function dayKeyInZone(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** True when the string is a well-formed calendar day that actually exists. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = dateFromKey(value)
  return keyFromDate(d) === value
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY)
export const addDaysKey = (key: string, n: number) => keyFromDate(addDays(dateFromKey(key), n))
export const daysBetweenKeys = (a: string, b: string) => daysBetween(dateFromKey(a), dateFromKey(b))

/**
 * Round into [min, max], but treat a non-finite or non-POSITIVE input as "no
 * measurement at all" and answer with the default instead of the minimum.
 *
 * That distinction matters. A zero average comes from two period logs sharing a
 * start date, which is an absent measurement — not a 21-day cycle. Snapping it
 * to the minimum would silently invent a short cycle and predict dates a week
 * early; falling back to the default at least says "we do not know yet", which
 * is what the confidence score alongside it is already telling the user.
 */
const clampInt = (n: number, min: number, max: number, fallback: number) => {
  const v = Math.round(n)
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(max, Math.max(min, v))
}

/**
 * Clamp an average cycle length into the clinical range.
 *
 * This is the guard that stops the whole dashboard collapsing. Two PeriodLog
 * rows sharing a start date produced `gaps = [0]` → `avgCycle = 0` →
 * `Math.floor(sinceLast / 0)` = Infinity → `Invalid Date` → "Period in NaN
 * days" everywhere. Duplicates are also prevented on write now, but the clamp
 * stays as the belt to that braces: a read must never be able to produce NaN.
 */
export const clampCycle = (n: number) => clampInt(n, CYCLE_MIN, CYCLE_MAX, DEFAULT_CYCLE)
export const clampPeriod = (n: number) => clampInt(n, PERIOD_MIN, PERIOD_MAX, DEFAULT_PERIOD)

// ── Windows ──────────────────────────────────────────────────────────────────

export interface CycleWindow {
  /** First day of the period this cycle opens with. */
  start: Date
  /** Last day of that period (start + avgPeriod - 1). */
  end: Date
  ovulation: Date
  fertileStart: Date
  fertileEnd: Date
  pmsStart: Date
  pmsEnd: Date
}

/**
 * Every window for the cycle that BEGINS on `start`. Ovulation sits 14 days
 * before the start, so the fertile and PMS windows of the cycle that leads up
 * to `start` are what this returns — which is what both the calendar and the
 * "Upcoming" panel need to describe the days between now and the next period.
 *
 * Only the period length is needed: a window is described relative to the start
 * it belongs to, and cycle length decides only where the NEXT start lands.
 */
export function cycleWindow(start: Date, avgPeriod: number): CycleWindow {
  const ovulation = addDays(start, -LUTEAL_DAYS)
  return {
    start,
    end: addDays(start, clampPeriod(avgPeriod) - 1),
    ovulation,
    fertileStart: addDays(ovulation, -FERTILE_BEFORE),
    fertileEnd: addDays(ovulation, FERTILE_AFTER),
    pmsStart: addDays(start, -PMS_DAYS),
    pmsEnd: addDays(start, -1),
  }
}

export interface PhaseInput {
  /** `YYYY-MM-DD` of the next predicted period start (prediction.nextStart). */
  nextStart: string
  avgCycle: number
  avgPeriod: number
  /** Real logged history. A logged period always wins over a predicted band. */
  periods?: { start: string; length: number }[]
}

const between = (d: Date, a: Date, b: Date) => d.getTime() >= a.getTime() && d.getTime() <= b.getTime()

/**
 * Phase for an arbitrary date. The precedence order is deliberate and shared by
 * every painter: logged period → predicted period → ovulation day → fertile
 * window → PMS. Testing ovulation before fertile is what keeps the single
 * ovulation day from being swallowed by the band it sits inside.
 *
 * `k` runs from -2 so a user paging back a month still sees the phases of the
 * cycles that have already closed, and forward far enough to cover a year.
 */
export function phaseForDate(date: Date, input: PhaseInput): CyclePhase {
  for (const p of input.periods ?? []) {
    const start = dateFromKey(p.start)
    if (between(date, start, addDays(start, clampPeriod(p.length) - 1))) return 'period'
  }
  const avgCycle = clampCycle(input.avgCycle)
  const avgPeriod = clampPeriod(input.avgPeriod)
  const firstNext = dateFromKey(input.nextStart)
  for (let k = -2; k < 14; k++) {
    const w = cycleWindow(addDays(firstNext, avgCycle * k), avgPeriod)
    if (between(date, w.start, w.end)) return 'predicted'
    if (date.getTime() === w.ovulation.getTime()) return 'ovulation'
    if (between(date, w.fertileStart, w.fertileEnd)) return 'fertile'
    if (between(date, w.pmsStart, w.pmsEnd)) return 'pms'
  }
  return null
}

/** Convenience wrapper for callers that hold a day key rather than a Date. */
export function phaseForDayKey(key: string, input: PhaseInput): CyclePhase {
  return phaseForDate(dateFromKey(key), input)
}

// ── Simple forward prediction (used by the signed-out landing tracker) ───────

export interface SimplePrediction {
  cycleDay: number
  cycleLength: number
  periodLength: number
  /** Day key of the next period start — always strictly in the future. */
  nextStart: string
  daysUntilNext: number
  phase: CyclePhase
  /** Day key of the start of the cycle today falls inside. */
  cycleStart: string
}

/**
 * Roll a single known start forward by whole cycles until it contains `today`.
 * This is what the landing tracker shows a visitor who has typed one date; the
 * dashboard's richer prediction uses measured gaps instead, but both agree on
 * the phase boundaries because both go through `phaseForDate`.
 */
export function predictFromLastStart(
  lastStartKey: string,
  today: string,
  cycleLengthInput: number,
  periodLengthInput: number,
): SimplePrediction | null {
  if (!isDayKey(lastStartKey) || !isDayKey(today)) return null
  const cycleLength = clampCycle(cycleLengthInput)
  const periodLength = clampPeriod(periodLengthInput)

  const last = dateFromKey(lastStartKey)
  const now = dateFromKey(today)
  // Math.max(0, …) so a start logged "tomorrow" (a ±1 tolerance write) still
  // yields cycle day 1 rather than a negative day.
  const elapsed = Math.max(0, daysBetween(last, now))
  const cyclesPassed = Math.floor(elapsed / cycleLength)
  const cycleStart = addDays(last, cyclesPassed * cycleLength)
  const nextStart = addDays(cycleStart, cycleLength)

  return {
    cycleDay: daysBetween(cycleStart, now) + 1,
    cycleLength,
    periodLength,
    nextStart: keyFromDate(nextStart),
    daysUntilNext: daysBetween(now, nextStart),
    cycleStart: keyFromDate(cycleStart),
    phase: phaseForDate(now, {
      nextStart: keyFromDate(nextStart),
      avgCycle: cycleLength,
      avgPeriod: periodLength,
      periods: [{ start: keyFromDate(cycleStart), length: periodLength }],
    }),
  }
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** Human labels for each phase. Colour is NEVER the only signal — pair with these. */
export const PHASE_LABEL: Record<Exclude<CyclePhase, null>, string> = {
  period: 'Period',
  predicted: 'Predicted period',
  fertile: 'Fertile window',
  ovulation: 'Ovulation',
  pms: 'PMS window',
}

/** One-line explanation, used in the calendar legend and the tracker tooltip. */
export const PHASE_HINT: Record<Exclude<CyclePhase, null>, string> = {
  period: 'A period you logged.',
  predicted: 'When we expect your next period to arrive.',
  fertile: 'The days around ovulation when conception is most likely.',
  ovulation: 'Your estimated peak fertility day.',
  pms: 'The days before your period when symptoms often build.',
}

const DATE_ONLY: Intl.DateTimeFormatOptions = { timeZone: 'UTC', day: 'numeric', month: 'short' }
const DATE_LONG: Intl.DateTimeFormatOptions = { timeZone: 'UTC', day: 'numeric', month: 'long' }

/** "14 Aug" — timeZone UTC because the Date is a UTC-midnight day marker. */
export const fmtShortKey = (key: string) => dateFromKey(key).toLocaleDateString('en-IN', DATE_ONLY)
/** "14 August" */
export const fmtLongKey = (key: string) => dateFromKey(key).toLocaleDateString('en-IN', DATE_LONG)
/** "14 Aug – 18 Aug" */
export const rangeLabel = (a: string, b: string) => `${fmtShortKey(a)} – ${fmtShortKey(b)}`

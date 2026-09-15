/**
 * Cycle arithmetic — real logic, not a stub.
 *
 * This module is pure: day keys in, day keys and phase names out. Nothing here
 * touches Postgres, so reconstructing it faithfully costs nothing and buys a
 * working homepage tracker and dashboard calendar. The behaviour below is
 * pinned by its two consumers, `src/components/CycleTracker.tsx` and
 * `src/screens/UserDashboard.tsx`.
 *
 * A "day key" is `YYYY-MM-DD`. Every key is interpreted at UTC midnight, and
 * both consumers format with `timeZone: 'UTC'` for the same reason: a cycle day
 * must not shift because the reader is east of Greenwich.
 */

export const CYCLE_MIN = 21
export const CYCLE_MAX = 45
export const DEFAULT_CYCLE = 28

export const PERIOD_MIN = 2
export const PERIOD_MAX = 10
export const DEFAULT_PERIOD = 5

export type CyclePhase = 'period' | 'predicted' | 'fertile' | 'ovulation' | 'pms' | null

export const PHASE_LABEL: Record<Exclude<CyclePhase, null>, string> = {
  period: 'Period',
  predicted: 'Predicted period',
  fertile: 'Fertile window',
  ovulation: 'Ovulation',
  pms: 'PMS',
}

export const PHASE_HINT: Record<Exclude<CyclePhase, null>, string> = {
  period: 'Flow days. Rest, hydrate, and change every 4 to 6 hours.',
  predicted: 'Your next period is expected around now.',
  fertile: 'The days either side of ovulation.',
  ovulation: 'Mid-cycle. Energy usually peaks here.',
  pms: 'The run-up to your period. Cramps and mood dips are common.',
}

const DAY = 86_400_000

export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00.000Z`)
  // Rejects 2026-02-31, which Date would otherwise roll forward to March.
  return !Number.isNaN(d.getTime()) && keyFromDate(d) === value
}

export function keyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export function addDaysKey(key: string, days: number): string {
  return keyFromDate(new Date(dateFromKey(key).getTime() + days * DAY))
}

/** `a - b`, in whole days. Positive when `a` is later than `b`. */
export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((dateFromKey(a).getTime() - dateFromKey(b).getTime()) / DAY)
}

/** Today where the visitor is standing, as a day key. */
export function localDayKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today in a named IANA zone. Used server-side, where the process is on UTC. */
export function dayKeyInZone(timeZone = 'Asia/Kolkata', date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  // en-CA already formats as YYYY-MM-DD.
  return parts
}

export function clampCycle(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULT_CYCLE
  return Math.min(CYCLE_MAX, Math.max(CYCLE_MIN, v))
}

export function clampPeriod(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULT_PERIOD
  return Math.min(PERIOD_MAX, Math.max(PERIOD_MIN, v))
}

/** One logged period: the day it started and how many days it ran. */
export interface PeriodSpan {
  start: string
  length: number
}

export interface CycleWindow {
  /** First day of the cycle the key falls in. */
  cycleStart: string
  /** First day of the next cycle. */
  nextStart: string
  /** 1-based day within the cycle. */
  cycleDay: number
}

/**
 * Which cycle a day falls in, given the most recent known start.
 *
 * Walks forward (or back) in whole cycles from `anchorStart` so a key months
 * either side of the anchor still lands in the right window.
 */
export function cycleWindow(key: string, anchorStart: string, avgCycle: number): CycleWindow {
  const cycle = clampCycle(avgCycle)
  const offset = daysBetweenKeys(key, anchorStart)
  const cyclesAway = Math.floor(offset / cycle)
  const cycleStart = addDaysKey(anchorStart, cyclesAway * cycle)
  return {
    cycleStart,
    nextStart: addDaysKey(cycleStart, cycle),
    cycleDay: daysBetweenKeys(key, cycleStart) + 1,
  }
}

export interface PhaseContext {
  /** The next predicted period start. */
  nextStart: string
  avgCycle: number
  avgPeriod: number
  /** Periods actually logged. A day inside one of these is `period`, not a guess. */
  periods: PeriodSpan[]
}

/**
 * The phase a day belongs to.
 *
 * Order of precedence matters, and it is the order below: a day that was
 * actually logged as flow is `period` even if the prediction disagrees, because
 * the log is evidence and the prediction is arithmetic.
 */
export function phaseForDayKey(key: string, ctx: PhaseContext): CyclePhase {
  const cycle = clampCycle(ctx.avgCycle)
  const period = clampPeriod(ctx.avgPeriod)

  // 1. Logged flow.
  for (const span of ctx.periods) {
    if (!isDayKey(span.start)) continue
    const day = daysBetweenKeys(key, span.start)
    if (day >= 0 && day < clampPeriod(span.length)) return 'period'
  }

  // 2. Everything else is measured against the cycle this day falls in.
  const anchor = addDaysKey(ctx.nextStart, -cycle)
  const { cycleStart, nextStart } = cycleWindow(key, anchor, cycle)
  const day = daysBetweenKeys(key, cycleStart) // 0-based

  if (day >= 0 && day < period) return 'predicted'

  // Ovulation is counted BACK from the next start (the luteal phase is the
  // stable half), not forward from the last one.
  const ovulation = daysBetweenKeys(addDaysKey(nextStart, -14), cycleStart)
  if (day === ovulation) return 'ovulation'
  if (day >= ovulation - 4 && day <= ovulation + 1) return 'fertile'

  const untilNext = daysBetweenKeys(nextStart, key)
  if (untilNext > 0 && untilNext <= 5) return 'pms'

  return null
}

export interface CyclePrediction {
  cycleStart: string
  nextStart: string
  nextStartLabel: string
  cycleDay: number
  daysUntilNext: number
  cycleLength: number
  periodLength: number
  avgCycle: number
  avgPeriod: number
  fertileStart: string
  fertileEnd: string
  ovulation: string
  phase: CyclePhase
  /** How much to trust this. One logged start is a guess, not a history. */
  confidence: 'low' | 'medium' | 'high'
}

/**
 * The whole prediction from a single known start date.
 *
 * This is the signed-out path: the homepage tracker asks for one date and has
 * to produce a full week strip from it, so everything below is derived from
 * `lastStart` plus the two lengths.
 */
export function predictFromLastStart(
  lastStart: string,
  today: string,
  cycleLength: number = DEFAULT_CYCLE,
  periodLength: number = DEFAULT_PERIOD,
): CyclePrediction {
  const cycle = clampCycle(cycleLength)
  const period = clampPeriod(periodLength)
  const { cycleStart, nextStart, cycleDay } = cycleWindow(today, lastStart, cycle)

  const ovulation = addDaysKey(nextStart, -14)

  return {
    cycleStart,
    nextStart,
    nextStartLabel: dateFromKey(nextStart).toLocaleDateString('en-IN', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    }),
    cycleDay,
    daysUntilNext: daysBetweenKeys(nextStart, today),
    cycleLength: cycle,
    periodLength: period,
    avgCycle: cycle,
    avgPeriod: period,
    fertileStart: addDaysKey(ovulation, -4),
    fertileEnd: addDaysKey(ovulation, 1),
    ovulation,
    phase: phaseForDayKey(today, {
      nextStart,
      avgCycle: cycle,
      avgPeriod: period,
      periods: [{ start: cycleStart, length: period }],
    }),
    // One start date is one data point. Saying "high" here would be a lie the
    // UI then prints next to a date.
    confidence: 'low',
  }
}

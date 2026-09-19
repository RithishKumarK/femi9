import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { logger } from '../logger'
import {
  cycleCryptoConfigured,
  encryptCyclePayload,
  periodDayHash,
  tryDecryptCyclePayload,
} from '../cycle-crypto'
import {
  DEFAULT_CYCLE,
  DEFAULT_PERIOD,
  addDaysKey,
  clampCycle,
  clampPeriod,
  cycleWindow,
  dateFromKey,
  dayKeyInZone,
  daysBetweenKeys,
  fmtLongKey,
  fmtShortKey,
  isDayKey,
  keyFromDate,
  predictFromLastStart,
  rangeLabel,
} from '../cycle-math'

/**
 * Cycle service — the read/write model behind /dashboard.
 *
 * Presentation-shaped on purpose (same convention as services/account.ts): it
 * hands UserDashboard the exact primitive shapes it draws so a Server Component →
 * Client Component handoff stays serializable. Dates cross the boundary as plain
 * `YYYY-MM-DD` keys (never Date objects), and every human-facing string (ranges,
 * the next-period label) is formatted here so the client never has to.
 *
 * All prediction and phase maths live in `./cycle-math`, which the dashboard
 * client and the landing tracker import too. That module is the single source of
 * truth for the fertile window, ovulation and the clamps — before it existed the
 * three surfaces had drifted into naming three different dates for one event.
 *
 * PRIVACY: period and symptom payloads are AES-256-GCM encrypted at rest. Rows
 * this process cannot decrypt are skipped and counted (`unreadableRows`), never
 * thrown — one bad row used to 500 the entire dashboard permanently.
 */

// ── View models (mirror exactly what UserDashboard renders) ──────────────────

/** Phase keys that also index the PHASE theme map in the UI. */
export type EventPhase = 'pms' | 'predicted' | 'fertile' | 'ovulation'
export type InsightTone = 'good' | 'warning' | 'info'

export interface CyclePrediction {
  /** Clamped to 21..35. Never 0, never NaN. */
  avgCycle: number
  /** Clamped to 1..15. */
  avgPeriod: number
  confidence: number // 0-100
  cycleDay: number
  nextStart: string // 'YYYY-MM-DD'
  nextStartLabel: string // "15 July" — preformatted so the client parses no dates
  daysUntilNext: number
  ovulation: string
  fertileStart: string // ovulation - 5
  fertileEnd: string // ovulation + 1 — one definition, shared by text and painters
  pmsStart: string
  pmsEnd: string
  lastStart: string
}

export interface UpcomingEvent {
  label: string
  range: string
  phase: EventPhase
  days: number
}

export interface CycleTrend {
  labels: string[]
  values: number[]
  /** Real measured gaps behind `values`. <2 ⇒ the UI must render an empty state
   *  rather than a synthesised line presented as history. */
  measured: number
}

export interface Insight {
  title: string
  body: string
  tone: InsightTone
}

export interface SymptomEntry {
  id: string
  day: string // symptom name (the UI keys/labels on `s.day`)
  level: number // 0-3
  date: string // 'YYYY-MM-DD' — so "Logged this cycle" can stop lying
  inCurrentCycle: boolean
  /** Optional free-text note the user attached to that day. */
  note: string | null
}

export interface PeriodEntry {
  id: string
  start: string // 'YYYY-MM-DD'
  length: number
  startLabel: string // "14 August" — preformatted for the logged-history panel
}

/** The user's most recent purchase, so "Smart reorder" stops inventing one. */
export interface LastOrderedProduct {
  name: string
  slug: string
  variantId: string | null
}

export interface CycleData {
  consent: boolean
  needsData: boolean // true when the user has logged no periods yet
  today: string // 'YYYY-MM-DD' resolved in the USER's timezone, not process UTC
  timezone: string // IANA, e.g. 'Asia/Kolkata'
  prediction: CyclePrediction
  upcomingEvents: UpcomingEvent[]
  cycleLengthTrend: CycleTrend
  insights: Insight[]
  symptomLog: SymptomEntry[]
  periods: PeriodEntry[] // logged history, so the client can rebuild the calendar
  lastOrderedProduct: LastOrderedProduct | null
  /** Rows that could not be decrypted. >0 ⇒ show "we couldn't read some of your
   *  history", never a 500. */
  unreadableRows: number
}

/**
 * The storefront's operating timezone.
 *
 * `User` carries no timezone column and this build does not add one (see the
 * contract's deferred list), so every user is resolved against the market the
 * product sells into. This is still strictly better than the old process-UTC
 * reference, which in IST reported yesterday's date until 05:30 every morning
 * and rejected a user's own "today" as being in the future.
 */
export const STORE_TIMEZONE = process.env.STORE_TIMEZONE?.trim() || 'Asia/Kolkata'

/** Consent was never given, so no health data may be written. Routes map this
 *  to 403 `{ code: 'consent_required' }` and the UI re-shows the consent card. */
export class CycleConsentRequiredError extends Error {
  readonly code = 'consent_required'
  constructor() {
    super('Cycle tracking needs your consent first.')
    this.name = 'CycleConsentRequiredError'
  }
}

/** A write arrived with a date the user cannot have lived through yet. */
export class FutureDateError extends Error {
  constructor() {
    super('That date is in the future')
    this.name = 'FutureDateError'
  }
}

// ── Local adapters over cycle-math ───────────────────────────────────────────
// cycle-math speaks Dates for windows (the calendar needs them); this service
// speaks day keys on the wire. These two are the only conversion points.

interface WindowKeys {
  start: string
  end: string
  ovulation: string
  fertileStart: string
  fertileEnd: string
  pmsStart: string
  pmsEnd: string
}

/** The window belonging to a cycle that starts on `startKey`, as day keys. */
function windowKeys(startKey: string, avgPeriod: number): WindowKeys {
  const w = cycleWindow(dateFromKey(startKey), avgPeriod)
  return {
    start: keyFromDate(w.start),
    end: keyFromDate(w.end),
    ovulation: keyFromDate(w.ovulation),
    fertileStart: keyFromDate(w.fertileStart),
    fertileEnd: keyFromDate(w.fertileEnd),
    pmsStart: keyFromDate(w.pmsStart),
    pmsEnd: keyFromDate(w.pmsEnd),
  }
}

/** The k-th cycle after `cycleStart` (k=0 is the next upcoming period). */
const futureWindow = (cycleStart: string, avgCycle: number, avgPeriod: number, k: number) =>
  windowKeys(addDaysKey(cycleStart, avgCycle * (k + 1)), avgPeriod)

const fmtMonthKey = (key: string) =>
  dateFromKey(key).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' })

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Real measured cycle gaps, in order.
 *
 * Gaps of 0 are filtered out rather than averaged in: they are a duplicate log,
 * not a zero-day cycle, and averaging them is exactly how avgCycle became 0 and
 * cascaded `Infinity` / `Invalid Date` / "Period in NaN days" through every
 * panel on the dashboard. Duplicates are prevented on write now too, but this
 * filter stays as the belt to that braces.
 */
function measuredGaps(startKeys: string[]): number[] {
  const sorted = [...startKeys].sort()
  return sorted
    .slice(1)
    .map((s, i) => daysBetweenKeys(sorted[i], s))
    .filter((g) => g > 0)
}

/**
 * Prediction confidence, 35..96. Grows with how many cycles we have measured
 * (coverage) and how consistent they are (low spread). Deliberately low with a
 * single logged period, which gives a start date but no measured cycle at all.
 */
function confidenceFrom(measured: number, spread: number): number {
  if (measured === 0) return 40
  const consistency = Math.max(0, 1 - spread / 8)
  const coverage = Math.min(1, measured / 5)
  const raw = Math.round((0.55 + 0.4 * coverage) * (0.6 + 0.4 * consistency) * 100)
  return Math.min(96, Math.max(35, raw))
}

// ── Shared read helpers ──────────────────────────────────────────────────────

/**
 * Validate a client-supplied `clientToday` and pick the reference day to compare
 * writes against.
 *
 * A ±1 day tolerance is deliberate: the client's clock is the authority on what
 * day it is for the user, but an unvalidated value would let anyone backdate or
 * postdate freely. One day of slack covers the timezone gap either side of the
 * date line without opening that hole.
 */
function referenceDay(clientToday?: string): { today: string; latestAllowed: string } {
  const serverToday = dayKeyInZone(STORE_TIMEZONE)
  if (clientToday && isDayKey(clientToday)) {
    const drift = Math.abs(daysBetweenKeys(serverToday, clientToday))
    if (drift <= 1) return { today: clientToday, latestAllowed: clientToday }
  }
  // No usable hint: still allow one day ahead so a user just past local midnight
  // in a zone east of ours is not told her own today has not happened yet.
  return { today: serverToday, latestAllowed: addDaysKey(serverToday, 1) }
}

async function requireConsent(brand: Brand, userId: string): Promise<void> {
  const prisma = dbFor(brand)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { cycleDataConsent: true },
  })
  if (!user?.cycleDataConsent) throw new CycleConsentRequiredError()
}

/** The most recent product the user actually bought, for the reorder surfaces. */
async function readLastOrderedProduct(brand: Brand, userId: string): Promise<LastOrderedProduct | null> {
  const prisma = dbFor(brand)
  const item = await prisma.orderItem.findFirst({
    where: { order: { userId, status: { in: ['paid', 'processing', 'shipped', 'delivered'] } } },
    orderBy: { order: { placedAt: 'desc' } },
    select: {
      productName: true,
      variantId: true,
      variant: { select: { id: true, product: { select: { slug: true, name: true } } } },
    },
  })
  if (item?.variant?.product) {
    return {
      name: item.variant.product.name,
      slug: item.variant.product.slug,
      variantId: item.variant.id,
    }
  }

  // No purchase yet — an active subscription is an equally real signal of what
  // this customer uses, and is what the reorder card should name.
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['active', 'paused'] } },
    orderBy: { createdAt: 'desc' },
    select: { variantId: true, variant: { select: { product: { select: { slug: true, name: true } } } } },
  })
  if (sub?.variant?.product) {
    return { name: sub.variant.product.name, slug: sub.variant.product.slug, variantId: sub.variantId }
  }
  return null
}

// ── Read model ───────────────────────────────────────────────────────────────

export async function getCycleData(brand: Brand, userId: string): Promise<CycleData> {
  const prisma = dbFor(brand)
  const [periodRows, user, symptomRows, lastOrderedProduct] = await Promise.all([
    prisma.periodLog.findMany({
      where: { userId },
      select: { id: true, startDate: true, lengthDays: true, encryptedData: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { cycleDataConsent: true } }),
    prisma.symptomLog.findMany({
      where: { userId },
      select: { id: true, date: true, symptom: true, level: true, encryptedData: true },
    }),
    readLastOrderedProduct(brand, userId),
  ])

  const todayKey = dayKeyInZone(STORE_TIMEZONE)
  let unreadableRows = 0

  // Decode period rows. An unreadable row is counted and skipped — never thrown.
  // We log the row id only; the payload is exactly what must never reach a log.
  const periods: PeriodEntry[] = []
  for (const row of periodRows) {
    if (row.encryptedData) {
      const payload = tryDecryptCyclePayload(row.encryptedData)
      if (
        !payload ||
        payload.kind !== 'period' ||
        !isDayKey(payload.start) ||
        typeof payload.length !== 'number'
      ) {
        unreadableRows += 1
        logger.warn('cycle_period_unreadable', { rowId: row.id })
        continue
      }
      periods.push({
        id: row.id,
        start: payload.start,
        length: payload.length,
        startLabel: fmtLongKey(payload.start),
      })
      continue
    }
    // Legacy plaintext rows, from before the encryption migration.
    if (!row.startDate || row.lengthDays == null) {
      unreadableRows += 1
      logger.warn('cycle_period_incomplete', { rowId: row.id })
      continue
    }
    const start = row.startDate.toISOString().slice(0, 10)
    periods.push({ id: row.id, start, length: row.lengthDays, startLabel: fmtLongKey(start) })
  }
  periods.sort((a, b) => a.start.localeCompare(b.start))

  const symptoms: { id: string; date: string; symptom: string; level: number; note: string | null }[] = []
  for (const row of symptomRows) {
    if (row.encryptedData) {
      const payload = tryDecryptCyclePayload(row.encryptedData)
      if (
        !payload ||
        payload.kind !== 'symptom' ||
        !isDayKey(payload.date) ||
        typeof payload.symptom !== 'string' ||
        typeof payload.level !== 'number'
      ) {
        unreadableRows += 1
        logger.warn('cycle_symptom_unreadable', { rowId: row.id })
        continue
      }
      symptoms.push({
        id: row.id,
        date: payload.date,
        symptom: payload.symptom,
        level: payload.level,
        note: typeof payload.note === 'string' ? payload.note : null,
      })
      continue
    }
    if (!row.date || !row.symptom || row.level == null) {
      unreadableRows += 1
      logger.warn('cycle_symptom_incomplete', { rowId: row.id })
      continue
    }
    symptoms.push({
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      symptom: row.symptom,
      level: row.level,
      note: null,
    })
  }
  symptoms.sort((a, b) => b.date.localeCompare(a.date))

  const startKeys = periods.map((p) => p.start)
  const gaps = measuredGaps(startKeys)
  const lengths = periods.map((p) => p.length)
  const measured = gaps.length
  // Both averages go through the shared clamps, so a corrupted history can only
  // ever produce a conservative default — never a 0 that divides into Infinity.
  const avgCycle = measured ? clampCycle(mean(gaps)) : DEFAULT_CYCLE
  const avgPeriod = lengths.length ? clampPeriod(mean(lengths)) : DEFAULT_PERIOD
  const spread = measured ? Math.sqrt(mean(gaps.map((g) => (g - mean(gaps)) ** 2))) : 0

  // No logs yet: hand back a valid (default) shape and flag it so the UI shows
  // the "log your first period" state instead of a fabricated prediction. The
  // symptom log still ships — the two logs are independent, and a user may want
  // to record cramps before she has entered a period start.
  if (periods.length === 0) {
    const nextStart = addDaysKey(todayKey, DEFAULT_CYCLE)
    const w = windowKeys(nextStart, DEFAULT_PERIOD)
    // Inclusive of today, so a DEFAULT_CYCLE-day window ends on today.
    const assumedCycleStart = addDaysKey(todayKey, -(DEFAULT_CYCLE - 1))
    return {
      consent: user?.cycleDataConsent ?? false,
      needsData: true,
      today: todayKey,
      timezone: STORE_TIMEZONE,
      prediction: {
        avgCycle: DEFAULT_CYCLE,
        avgPeriod: DEFAULT_PERIOD,
        confidence: 0,
        cycleDay: 1,
        nextStart,
        nextStartLabel: fmtLongKey(nextStart),
        daysUntilNext: DEFAULT_CYCLE,
        ovulation: w.ovulation,
        fertileStart: w.fertileStart,
        fertileEnd: w.fertileEnd,
        pmsStart: w.pmsStart,
        pmsEnd: w.pmsEnd,
        lastStart: todayKey,
      },
      upcomingEvents: [],
      cycleLengthTrend: { labels: [], values: [], measured: 0 },
      insights: [],
      // No period start is logged, so there is no MEASURED cycle boundary — but
      // "no boundary" is not the same as "nothing is current". Flagging every
      // entry false filed a symptom logged *today* under "Earlier", which reads
      // as a bug to the person who just typed it. Fall back to the default
      // cycle length, exactly as the prediction above already does, so the
      // window is a defensible ~28 days ending today and the grouping matches
      // the shape used once real periods exist (>= cycleStart, <= today).
      symptomLog: symptoms.slice(0, 12).map((s) => ({
        id: s.id,
        day: s.symptom,
        level: s.level,
        date: s.date,
        inCurrentCycle: s.date >= assumedCycleStart && s.date <= todayKey,
        note: s.note,
      })),
      periods,
      lastOrderedProduct,
      unreadableRows,
    }
  }

  const lastStart = startKeys[startKeys.length - 1]
  // predictFromLastStart rolls the last logged start forward by whole cycles to
  // the one containing today, so cycleDay stays in range and daysUntilNext stays
  // positive even for a user who has not logged in months. It cannot return null
  // here: both keys came from `isDayKey`-validated data.
  const core =
    predictFromLastStart(lastStart, todayKey, avgCycle, avgPeriod) ??
    ({ cycleStart: todayKey, cycleDay: 1, cycleLength: avgCycle, periodLength: avgPeriod, daysUntilNext: avgCycle } as const)
  const confidence = confidenceFrom(measured, spread)

  // c0 is the NEXT upcoming cycle. Everything the user is shown about fertility
  // and ovulation reads from c0; c1 is only a fallback for a window that has
  // already passed. Reading c1 unconditionally is what put ovulation on the
  // calendar 12 days out and in the Upcoming panel 40 days out on one screen.
  const c0 = futureWindow(core.cycleStart, core.cycleLength, core.periodLength, 0)
  const c1 = futureWindow(core.cycleStart, core.cycleLength, core.periodLength, 1)
  const fertile = c0.fertileEnd >= todayKey ? c0 : c1
  const ovulationCycle = c0.ovulation >= todayKey ? c0 : c1

  const prediction: CyclePrediction = {
    avgCycle: core.cycleLength,
    avgPeriod: core.periodLength,
    confidence,
    cycleDay: core.cycleDay,
    nextStart: c0.start,
    nextStartLabel: fmtLongKey(c0.start),
    daysUntilNext: core.daysUntilNext,
    ovulation: c0.ovulation,
    fertileStart: c0.fertileStart,
    fertileEnd: c0.fertileEnd,
    pmsStart: c0.pmsStart,
    pmsEnd: c0.pmsEnd,
    lastStart,
  }

  const upcomingEvents: UpcomingEvent[] = [
    {
      label: 'PMS window',
      range: rangeLabel(c0.pmsStart, c0.pmsEnd),
      phase: 'pms',
      days: daysBetweenKeys(todayKey, c0.pmsStart),
    },
    {
      label: 'Next period',
      range: rangeLabel(c0.start, c0.end),
      phase: 'predicted',
      days: core.daysUntilNext,
    },
    {
      label: 'Fertile window',
      range: rangeLabel(fertile.fertileStart, fertile.fertileEnd),
      phase: 'fertile',
      days: daysBetweenKeys(todayKey, fertile.fertileStart),
    },
    {
      label: 'Ovulation',
      range: fmtShortKey(ovulationCycle.ovulation),
      phase: 'ovulation',
      days: daysBetweenKeys(todayKey, ovulationCycle.ovulation),
    },
  ]

  // Cycle-length trend: only REAL measured gaps, labelled by the month the cycle
  // closed in. With fewer than two we ship an empty series and let the UI say
  // "log two periods to see your trend" — synthesising a flat line off the
  // default presented invented history as measurement.
  const trendValues = gaps.length >= 2 ? gaps.slice(-6) : []
  const trendLabels = trendValues.map((_, i) => fmtMonthKey(startKeys[startKeys.length - trendValues.length + i]))

  // Symptoms are "this cycle" only when they fall in the window that started at
  // core.cycleStart. Everything older is still shown, but with its own date.
  const symptomLog: SymptomEntry[] = symptoms.slice(0, 20).map((s) => ({
    id: s.id,
    day: s.symptom,
    level: s.level,
    date: s.date,
    inCurrentCycle: s.date >= core.cycleStart && s.date <= todayKey,
    note: s.note,
  }))

  const insights: Insight[] = []
  if (measured < 1) {
    insights.push({
      title: 'Log another period to sharpen this',
      body: `Predictions start rough and tighten with every cycle you log. Right now we are about ${confidence}% confident.`,
      tone: 'info',
    })
  } else if (spread <= 2) {
    const days = Math.max(1, Math.round(spread))
    insights.push({
      title: 'Your cycle is regular',
      body: `Your last ${measured} cycle${measured === 1 ? '' : 's'} varied by under ${days} day${days === 1 ? '' : 's'}. Predictions are ${confidence}% confident.`,
      tone: 'good',
    })
  } else {
    insights.push({
      title: 'Your cycle varies a little',
      body: `Recent cycles swung by about ${Math.round(spread)} days, so treat these dates as a guide. Around ${confidence}% confident.`,
      tone: 'info',
    })
  }
  insights.push({
    title: 'PMS window ahead',
    body: `Around ${rangeLabel(c0.pmsStart, c0.pmsEnd)}. Keep a Night+Day pack handy and take it easy.`,
    tone: 'warning',
  })
  // Only claim a reorder when the customer has actually bought something, and
  // name what she really bought. This used to tell a day-one user that her
  // "330mm Double Wings" were running out.
  if (lastOrderedProduct) {
    insights.push({
      title: `Reorder before ${prediction.nextStartLabel}`,
      body: `Your ${lastOrderedProduct.name} usually runs out around your period start.`,
      tone: 'info',
    })
  }

  return {
    consent: user?.cycleDataConsent ?? false,
    needsData: false,
    today: todayKey,
    timezone: STORE_TIMEZONE,
    prediction,
    upcomingEvents,
    cycleLengthTrend: { labels: trendLabels, values: trendValues, measured: gaps.length },
    insights,
    symptomLog,
    periods,
    lastOrderedProduct,
    unreadableRows,
  }
}

// ── Writers ──────────────────────────────────────────────────────────────────

/**
 * Log a period start.
 *
 * An UPSERT on `(userId, startDayHash)`, not a create: the landing tracker
 * re-POSTs on every "Show Prediction", so the same start was trivially logged
 * twice, producing a gap of 0 and an avgCycle of 0 that turned the entire
 * dashboard into "Period in NaN days". Re-submitting a day now corrects it.
 *
 * Returns `deduped: true` when an existing row was updated rather than created,
 * so the route can answer 200 instead of 201.
 */
export async function logPeriod(brand: Brand, 
  userId: string,
  startDate: string,
  lengthDays: number,
  clientToday?: string,
): Promise<{ id: string; deduped: boolean }> {
  const prisma = dbFor(brand)
  await requireConsent(brand, userId)
  const { latestAllowed } = referenceDay(clientToday)
  if (!isDayKey(startDate) || startDate > latestAllowed) throw new FutureDateError()

  const hash = periodDayHash(userId, startDate)
  const encryptedData = encryptCyclePayload({ kind: 'period', start: startDate, length: lengthDays })

  const existing = await prisma.periodLog.findFirst({
    where: { userId, startDayHash: hash },
    select: { id: true },
  })
  if (existing) {
    await prisma.periodLog.update({ where: { id: existing.id }, data: { encryptedData } })
    return { id: existing.id, deduped: true }
  }
  const created = await prisma.periodLog.create({
    data: { userId, startDayHash: hash, encryptedData },
    select: { id: true },
  })
  return { id: created.id, deduped: false }
}

/** Correct an already-logged period. Re-encrypts the payload and re-keys the
 *  day hash, so moving a start onto a day that already exists is refused by the
 *  unique index rather than creating a duplicate. */
export async function updatePeriod(brand: Brand, 
  userId: string,
  id: string,
  startDate: string,
  lengthDays: number,
  clientToday?: string,
): Promise<boolean> {
  const prisma = dbFor(brand)
  await requireConsent(brand, userId)
  const { latestAllowed } = referenceDay(clientToday)
  if (!isDayKey(startDate) || startDate > latestAllowed) throw new FutureDateError()

  const owned = await prisma.periodLog.findFirst({ where: { id, userId }, select: { id: true } })
  if (!owned) return false

  // Any other row already on this day is the same fact; fold into one row.
  const clash = await prisma.periodLog.findFirst({
    where: { userId, startDayHash: periodDayHash(userId, startDate), NOT: { id } },
    select: { id: true },
  })
  if (clash) await prisma.periodLog.delete({ where: { id: clash.id } })

  await prisma.periodLog.update({
    where: { id },
    data: {
      startDayHash: periodDayHash(userId, startDate),
      encryptedData: encryptCyclePayload({ kind: 'period', start: startDate, length: lengthDays }),
    },
  })
  return true
}

/** Log a symptom intensity (0-3) for a given day, with an optional free-text
 *  note that rides inside the encrypted payload (never a plaintext column). */
export async function logSymptom(brand: Brand, 
  userId: string,
  date: string,
  symptom: string,
  level: number,
  clientToday?: string,
  note?: string,
): Promise<void> {
  const prisma = dbFor(brand)
  await requireConsent(brand, userId)
  const { latestAllowed } = referenceDay(clientToday)
  if (!isDayKey(date) || date > latestAllowed) throw new FutureDateError()

  await prisma.symptomLog.create({
    data: {
      userId,
      encryptedData: encryptCyclePayload({
        kind: 'symptom',
        date,
        symptom,
        level,
        ...(note ? { note } : {}),
      }),
    },
  })
}

/** Correct an already-logged symptom (re-encrypts the payload). */
export async function updateSymptom(brand: Brand, 
  userId: string,
  id: string,
  patch: { date?: string; symptom?: string; level?: number },
  clientToday?: string,
): Promise<boolean> {
  const prisma = dbFor(brand)
  await requireConsent(brand, userId)
  const row = await prisma.symptomLog.findFirst({
    where: { id, userId },
    select: { id: true, encryptedData: true, date: true, symptom: true, level: true },
  })
  if (!row) return false

  const current = row.encryptedData ? tryDecryptCyclePayload(row.encryptedData) : null
  const date =
    patch.date ??
    (typeof current?.date === 'string' ? current.date : row.date?.toISOString().slice(0, 10)) ??
    ''
  const symptom =
    patch.symptom ?? (typeof current?.symptom === 'string' ? current.symptom : row.symptom) ?? ''
  const level = patch.level ?? (typeof current?.level === 'number' ? current.level : row.level) ?? 0

  const { latestAllowed } = referenceDay(clientToday)
  if (!isDayKey(date) || date > latestAllowed) throw new FutureDateError()
  if (!symptom) return false

  await prisma.symptomLog.update({
    where: { id },
    data: { encryptedData: encryptCyclePayload({ kind: 'symptom', date, symptom, level }) },
  })
  return true
}

export async function deletePeriod(brand: Brand, userId: string, id: string): Promise<boolean> {
  const prisma = dbFor(brand)
  const result = await prisma.periodLog.deleteMany({ where: { id, userId } })
  return result.count === 1
}

export async function deleteSymptom(brand: Brand, userId: string, id: string): Promise<boolean> {
  const prisma = dbFor(brand)
  const result = await prisma.symptomLog.deleteMany({ where: { id, userId } })
  return result.count === 1
}

/**
 * Set (or withdraw) cycle-tracking consent.
 *
 * Withdrawing is a deletion, not just a flag flip: a user who says "stop keeping
 * my menstrual data" means the rows too, and the UI copy says so explicitly
 * before she confirms.
 */
export async function setCycleConsent(brand: Brand, userId: string, consent: boolean): Promise<boolean> {
  const prisma = dbFor(brand)
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({ where: { id: userId }, data: { cycleDataConsent: consent } })
    if (result.count !== 1) return false
    if (!consent) {
      await tx.periodLog.deleteMany({ where: { userId } })
      await tx.symptomLog.deleteMany({ where: { userId } })
    }
    return true
  })
}

/** Whether cycle writes can work at all in this deployment. The routes surface
 *  a 503 rather than a 500 when the encryption key is missing. */
export function cycleStorageReady(): boolean {
  return cycleCryptoConfigured()
}

import 'server-only'
import { Prisma } from '@prisma/client'
import type {
  BabySex,
  BloodGroup as DbBloodGroup,
  DoseAgeUnit,
  VaccinationStatus,
  VaccineTrack,
} from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Parenting tools — the service layer behind Lumi9's /parenting-tools.
 *
 * Everything this surface knew used to live in the browser: one localStorage
 * blob for the baby, two hardcoded TypeScript modules for the medical tables,
 * and an email route that sent a plan and kept nothing. This is the seam that
 * gives the page a backend.
 *
 * Three rules shape every function below.
 *
 * **The privacy promise is kept where it was made.** A signed-out parent still
 * writes nothing — the localStorage store stays, and nothing here is reachable
 * without a `userId`. The ONLY exception is `recordParentingLead`, and only
 * because a parent typed an address and asked us to send something to it.
 *
 * **Dates are DATES.** `dob`, `takenOn` and `givenOn` are `@db.Date` columns and
 * cross this boundary as `YYYY-MM-DD` strings, never as `Date`. A birthday has
 * no time and no zone; a UTC-midnight timestamp read back in IST is the day
 * before, which on this page dates every single vaccination one day early. It
 * is also what a Server Component → Client Component handoff requires — a `Date`
 * is not serializable across it.
 *
 * **No date MATHS happens here.** Dating a dose from a birthday, correcting an
 * age for prematurity and walking the WHO tables forward are pure functions with
 * their own tests in `apps/lumi9-web/src/lib/`. This module returns rows. Moving
 * the arithmetic server-side would cost a round trip per keystroke on tools whose
 * whole appeal is that they answer instantly.
 */

// ── Wire types ───────────────────────────────────────────────────────────────

/** `YYYY-MM-DD`. The only date shape that crosses this boundary. */
export type IsoDate = string

/**
 * Blood group as a PERSON writes it, which is what crosses this boundary.
 *
 * Postgres stores exactly these strings — the enum's labels are `'A+'`, `'A-'`
 * and so on. Prisma cannot name a TypeScript member `A+`, so the schema maps
 * them to `A_POS`/`A_NEG`/… and the generated client speaks in those. That is a
 * client-generator artefact, not a fact about the data, and it must not leak
 * past this file: a storefront that has to translate `A_POS` before printing it
 * is one refactor away from printing `A_POS`.
 *
 * So the pair below is the only place the two vocabularies meet. Both maps are
 * exhaustive `Record`s rather than string surgery, so adding a group to the enum
 * without adding it here fails to compile instead of returning `undefined` for
 * somebody's blood type.
 */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
export type BloodGroup = (typeof BLOOD_GROUPS)[number]

const TO_LABEL: Record<DbBloodGroup, BloodGroup> = {
  A_POS: 'A+',
  A_NEG: 'A-',
  B_POS: 'B+',
  B_NEG: 'B-',
  AB_POS: 'AB+',
  AB_NEG: 'AB-',
  O_POS: 'O+',
  O_NEG: 'O-',
}

const TO_DB: Record<BloodGroup, DbBloodGroup> = {
  'A+': 'A_POS',
  'A-': 'A_NEG',
  'B+': 'B_POS',
  'B-': 'B_NEG',
  'AB+': 'AB_POS',
  'AB-': 'AB_NEG',
  'O+': 'O_POS',
  'O-': 'O_NEG',
}

/**
 * The stored enum member → what a person reads.
 *
 * Exported because the admin service needs the same translation, and two copies
 * of it is exactly the drift this map exists to prevent.
 */
export function bloodGroupLabel(value: DbBloodGroup | null): BloodGroup | null {
  return value ? TO_LABEL[value] : null
}

const toLabel = bloodGroupLabel

function toDb(value: BloodGroup | null | undefined): DbBloodGroup | null {
  return value ? TO_DB[value] : null
}

export interface BabyProfileDTO {
  id: string
  name: string | null
  dob: IsoDate
  sex: BabySex
  weightKg: number | null
  heightCm: number | null
  gestationalWeeks: number | null
  bloodGroup: BloodGroup | null
  updatedAt: string
}

export interface BabyMeasurementDTO {
  takenOn: IsoDate
  weightKg: number | null
  heightCm: number | null
}

/**
 * One dose, in the shape the storefront's `scheduleFor()` already speaks.
 *
 * `at` is reassembled from the two columns rather than exposed as
 * `ageUnit`/`ageValue`, so the dating function and its fixtures are untouched by
 * where the doses now come from — the schedule became a query without the maths
 * noticing.
 */
export interface VaccineDoseDTO {
  /** The stable key. `id` is a cuid nothing outside the database should hold. */
  code: string
  vaccine: string
  dose: string
  at: { unit: DoseAgeUnit; value: number }
  tracks: VaccineTrack[]
  note?: string
}

export interface BabyVaccinationDTO {
  code: string
  status: VaccinationStatus
  givenOn: IsoDate | null
}

export interface SaveBabyProfileInput {
  /** Absent creates a child; present edits one, if this account owns it. */
  id?: string | null
  name?: string | null
  dob: IsoDate
  sex: BabySex
  weightKg?: number | null
  heightCm?: number | null
  gestationalWeeks?: number | null
  bloodGroup?: BloodGroup | null
}

// ── Date coercion ────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `YYYY-MM-DD` → the `Date` a `@db.Date` column wants.
 *
 * Anchored at UTC midnight explicitly. `new Date('2026-03-01')` already parses
 * as UTC, but `new Date(2026, 2, 1)` does not, and the two are a day apart for
 * every caller east of Greenwich — the difference between a baby's first
 * birthday and the day before it.
 */
function toDate(iso: IsoDate): Date {
  if (!ISO_DATE_RE.test(iso)) throw new Error(`Not an ISO date: ${iso}`)
  return new Date(`${iso}T00:00:00.000Z`)
}

/** The inverse. Read in UTC, because that is the zone it was written in. */
function toIso(date: Date | null): IsoDate | null {
  return date ? date.toISOString().slice(0, 10) : null
}

// ── The baby ─────────────────────────────────────────────────────────────────

function toProfileDTO(row: {
  id: string
  name: string | null
  dob: Date
  sex: BabySex
  weightKg: number | null
  heightCm: number | null
  gestationalWeeks: number | null
  bloodGroup: DbBloodGroup | null
  updatedAt: Date
}): BabyProfileDTO {
  return {
    id: row.id,
    name: row.name,
    dob: toIso(row.dob) as IsoDate,
    sex: row.sex,
    weightKg: row.weightKg,
    heightCm: row.heightCm,
    gestationalWeeks: row.gestationalWeeks,
    bloodGroup: toLabel(row.bloodGroup),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Every child on this account, oldest first.
 *
 * Ordered by date of birth rather than by when the row was written, so the list
 * a parent reads is the order they would say their children's names in, and it
 * does not reshuffle when they edit one.
 */
export async function listBabies(brand: Brand, userId: string): Promise<BabyProfileDTO[]> {
  const rows = await dbFor(brand).babyProfile.findMany({
    where: { userId },
    orderBy: [{ dob: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toProfileDTO)
}

/**
 * One child, and ONLY if this account owns them.
 *
 * `userId` is in the filter, not checked afterwards. It is the authorisation
 * half of the key: `BabyProfile.userId` used to be unique, so "this user's
 * baby" was a single row the database could point at and a lookup by `id`
 * alone was harmless. It is not any more — a `babyId` from another account is
 * a valid cuid, and finding it by `id` would return another family's child.
 */
export async function getBaby(
  brand: Brand,
  userId: string,
  babyId: string,
): Promise<BabyProfileDTO | null> {
  const row = await dbFor(brand).babyProfile.findFirst({ where: { id: babyId, userId } })
  return row ? toProfileDTO(row) : null
}

/**
 * Create or replace this account's baby, and log the measurement.
 *
 * The profile's `weightKg`/`heightCm` are the LATEST reading — denormalised
 * because every tool on the page asks "how big is this baby now" and none of
 * them asks for a series. `BabyMeasurement` is the series, so an edit stops
 * destroying the previous value the way the localStorage blob always did.
 *
 * One transaction, because a profile whose measurement row failed to write is a
 * growth chart with a hole in it that nothing would ever report.
 *
 * The measurement is keyed by `(babyId, takenOn)` and upserted: a parent nudging
 * the weight field three times in a sitting is one reading, not three. `takenOn`
 * is the CALLER'S today, not `new Date()` — the route derives it from the
 * request so a test can fix it, and so a server in UTC does not file an evening
 * measurement in India under tomorrow's date.
 *
 * Returns `'unknown-user'` rather than throwing when `userId` has no `User` row.
 * Session tokens are verified by SIGNATURE alone and last 30 days, so a cookie
 * outlives the account it names — after a deletion, or against a database that
 * has been reset under it. That is a stale identity, not a server fault: without
 * this the FK violation surfaced as a 500 and the card told a parent their
 * baby's details "couldn't sync" on every single save, with nothing to act on.
 * Same stance `/api/auth/me` takes — a session whose user is gone reads as
 * signed out.
 */
export type SaveBabyProfileResult =
  | { status: 'ok'; profile: BabyProfileDTO }
  | { status: 'unknown-user' }
  /** The `id` names a child this account does not own, or one that is gone. */
  | { status: 'not-found' }
  | { status: 'too-many' }

/**
 * A ceiling, so a scripted client cannot write unbounded rows against one
 * account. It is deliberately well clear of any real family - this is a guard
 * on the endpoint, not an opinion about how many children somebody has.
 */
export const MAX_CHILDREN = 12

export async function saveBabyProfile(
  brand: Brand,
  userId: string,
  input: SaveBabyProfileInput,
  today: IsoDate,
): Promise<SaveBabyProfileResult> {
  const prisma = dbFor(brand)

  const data = {
    name: input.name?.trim() || null,
    dob: toDate(input.dob),
    sex: input.sex,
    weightKg: input.weightKg ?? null,
    heightCm: input.heightCm ?? null,
    gestationalWeeks: input.gestationalWeeks ?? null,
    bloodGroup: toDb(input.bloodGroup),
  }

  try {
    return await prisma.$transaction(async (tx) => {
      /* Not an upsert on `userId` any more — that WAS the one-child rule, and
         it is what silently overwrote a first child when a second was added.
         An `id` means "edit this one" and is scoped to the account before it is
         trusted; no `id` means "add a child". `updateMany` rather than `update`
         so the ownership filter is part of the write itself: `update` can only
         be keyed on a unique field, which would put `userId` back outside the
         query and turn authorisation into a separate check somebody can drop. */
      let row
      if (input.id) {
        const owned = await tx.babyProfile.updateMany({
          where: { id: input.id, userId },
          data,
        })
        if (owned.count === 0) return { status: 'not-found' as const }
        row = await tx.babyProfile.findFirstOrThrow({ where: { id: input.id, userId } })
      } else {
        if ((await tx.babyProfile.count({ where: { userId } })) >= MAX_CHILDREN) {
          return { status: 'too-many' as const }
        }
        row = await tx.babyProfile.create({ data: { userId, ...data } })
      }

      // Only when there is something to record. A profile saved with the weight
      // field left empty must not write a row of two nulls — that is an empty
      // point on a chart, not a measurement, and it would take the day's slot.
      if (data.weightKg !== null || data.heightCm !== null) {
        const takenOn = toDate(today)
        await tx.babyMeasurement.upsert({
          where: { babyId_takenOn: { babyId: row.id, takenOn } },
          create: { babyId: row.id, takenOn, weightKg: data.weightKg, heightCm: data.heightCm },
          update: { weightKg: data.weightKg, heightCm: data.heightCm },
        })
      }

      return { status: 'ok' as const, profile: toProfileDTO(row) }
    })
  } catch (err) {
    // Narrowed to THIS constraint. Any other foreign key failing here would be a
    // real bug, and swallowing it as "sign in again" would send a parent round a
    // loop that never fixes anything.
    if (isUnknownUser(err)) return { status: 'unknown-user' }
    throw err
  }
}

/**
 * P2003 on `BabyProfile.userId` — the session names a `User` that is gone.
 *
 * Prisma reports the constraint by NAME in `meta.constraint`, so this reads the
 * one FK it means rather than treating every P2003 as an expired session. If a
 * future client stops populating `meta` the check simply stops matching and the
 * failure goes back to being a loud 500, which is the right way for it to break.
 */
const USER_FK = 'BabyProfile_userId_fkey'

function isUnknownUser(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2003' &&
    (err.meta as { constraint?: unknown } | undefined)?.constraint === USER_FK
  )
}

/**
 * Forget this account's baby.
 *
 * Measurements and vaccination records cascade — the "Clear" button on the card
 * means clear, and leaving a child's health history behind an absent profile
 * would be the kind of orphan nobody ever goes looking for.
 *
 * `deleteMany`, not `delete`: pressing Clear twice is not an error.
 */
/**
 * Remove one child, and only from the account that owns them.
 *
 * `deleteMany` with both keys: it is idempotent (pressing Clear twice is not an
 * error) and the ownership filter is part of the statement rather than a check
 * before it. Measurements and vaccinations cascade from the row.
 */
export async function deleteBaby(brand: Brand, userId: string, babyId: string): Promise<void> {
  await dbFor(brand).babyProfile.deleteMany({ where: { id: babyId, userId } })
}

/**
 * Weight and height over time, oldest first — the order a chart plots in —
 * for every child on the account, grouped by child.
 *
 * ONE query for the whole family rather than one per child: a parent with five
 * children would otherwise cost five round trips on every page load of a hub
 * that already makes three. `baby: { userId }` is the authorisation, same as
 * everywhere else here.
 */
export async function listMeasurementsByBaby(
  brand: Brand,
  userId: string,
): Promise<Map<string, BabyMeasurementDTO[]>> {
  const rows = await dbFor(brand).babyMeasurement.findMany({
    where: { baby: { userId } },
    orderBy: { takenOn: 'asc' },
    select: { babyId: true, takenOn: true, weightKg: true, heightCm: true },
  })
  const out = new Map<string, BabyMeasurementDTO[]>()
  for (const r of rows) {
    const list = out.get(r.babyId) ?? []
    list.push({ takenOn: toIso(r.takenOn) as IsoDate, weightKg: r.weightKg, heightCm: r.heightCm })
    out.set(r.babyId, list)
  }
  return out
}

// ── The schedule ─────────────────────────────────────────────────────────────

/**
 * The published immunisation schedule.
 *
 * Ordered by `position` — the order the seed writes and the console's move
 * buttons preserve — which groups a single visit's doses the way the published
 * table prints them. Ordering by due age instead would scatter the five doses of
 * a 6-week appointment across the list.
 *
 * Inactive rows are dropped rather than flagged: a dose withdrawn from the
 * schedule should vanish from a parent's list, and there is no read that wants
 * both. The console reads them through its own query.
 */
export async function getVaccineSchedule(brand: Brand): Promise<VaccineDoseDTO[]> {
  const rows = await dbFor(brand).vaccineDose.findMany({
    where: { active: true },
    orderBy: [{ position: 'asc' }, { code: 'asc' }],
    select: {
      code: true,
      vaccine: true,
      dose: true,
      ageUnit: true,
      ageValue: true,
      tracks: true,
      note: true,
    },
  })
  return rows.map((r) => ({
    code: r.code,
    vaccine: r.vaccine,
    dose: r.dose,
    at: { unit: r.ageUnit, value: r.ageValue },
    tracks: r.tracks,
    ...(r.note ? { note: r.note } : {}),
  }))
}

/**
 * What this parent has marked given or skipped, grouped by child.
 *
 * One query for the family, for the same reason `listMeasurementsByBaby` is.
 * Ticks belong to a CHILD, not to an account: two siblings are on the same
 * schedule at different dates, and a flat map keyed on dose code alone would
 * have marked the younger one's doses given because the elder had them.
 */
export async function listVaccinationsByBaby(
  brand: Brand,
  userId: string,
): Promise<Map<string, BabyVaccinationDTO[]>> {
  const rows = await dbFor(brand).babyVaccination.findMany({
    where: { baby: { userId } },
    select: { babyId: true, status: true, givenOn: true, dose: { select: { code: true } } },
  })
  const out = new Map<string, BabyVaccinationDTO[]>()
  for (const r of rows) {
    const list = out.get(r.babyId) ?? []
    list.push({ code: r.dose.code, status: r.status, givenOn: toIso(r.givenOn) })
    out.set(r.babyId, list)
  }
  return out
}

/**
 * Mark one dose given, skipped, or neither.
 *
 * `status: null` DELETES the record — un-ticking a box a parent ticked by
 * mistake must remove the claim, not store a third state meaning "actually no".
 * Returns `'no-profile'` rather than throwing, because a signed-in shopper with
 * no baby yet is an ordinary state of this page, not an error.
 *
 * Addressed by dose CODE, never by row id: the code is the stable key, so
 * re-seeding a corrected schedule leaves every parent's record pointing at the
 * dose they actually ticked.
 */
export async function setVaccination(
  brand: Brand,
  userId: string,
  babyId: string,
  input: { code: string; status: VaccinationStatus | null; givenOn?: IsoDate | null },
): Promise<{ status: 'ok' } | { status: 'no-profile' } | { status: 'no-dose' }> {
  const prisma = dbFor(brand)

  const [baby, dose] = await Promise.all([
    // Both keys. A `babyId` on its own is another family's child.
    prisma.babyProfile.findFirst({ where: { id: babyId, userId }, select: { id: true } }),
    prisma.vaccineDose.findUnique({ where: { code: input.code }, select: { id: true } }),
  ])
  if (!baby) return { status: 'no-profile' }
  if (!dose) return { status: 'no-dose' }

  if (input.status === null) {
    await prisma.babyVaccination.deleteMany({ where: { babyId: baby.id, doseId: dose.id } })
    return { status: 'ok' }
  }

  // A skipped dose has no date by definition, so the column is cleared rather
  // than left holding whatever a previous "given" wrote.
  const givenOn =
    input.status === 'given' && input.givenOn ? toDate(input.givenOn) : null

  await prisma.babyVaccination.upsert({
    where: { babyId_doseId: { babyId: baby.id, doseId: dose.id } },
    create: { babyId: baby.id, doseId: dose.id, status: input.status, givenOn },
    update: { status: input.status, givenOn },
  })
  return { status: 'ok' }
}

// ── The care-plan lead ───────────────────────────────────────────────────────

export interface ParentingLeadInput {
  email: string
  babyName?: string | null
  dob?: IsoDate | null
  sex?: BabySex | null
  bloodGroup?: BloodGroup | null
  source?: string | null
  userId?: string | null
}

/**
 * Record that a parent asked for a care plan.
 *
 * The route used to send the email and keep nothing, so the one piece of
 * first-party data this surface collects reached the outbox and no further: no
 * list to follow up, no way to tell whether the feature is used, and no record
 * that the address was given for THIS purpose — which is what makes a later
 * marketing send defensible or not.
 *
 * Upserted on email, bumping `planCount`, so a returning parent is one row with
 * a count rather than a unique violation the route has to swallow. The baby
 * details are overwritten because the newer submission is the truer one.
 *
 * Never throws to the caller: failing to file a lead must not turn a plan the
 * parent DID receive into an error on their screen. The route logs it.
 */
export async function recordParentingLead(
  brand: Brand,
  input: ParentingLeadInput,
): Promise<void> {
  const email = input.email.trim().toLowerCase()
  const shared = {
    babyName: input.babyName?.trim() || null,
    dob: input.dob ? toDate(input.dob) : null,
    sex: input.sex ?? null,
    bloodGroup: toDb(input.bloodGroup),
    source: input.source ?? null,
    userId: input.userId ?? null,
    lastSentAt: new Date(),
  }

  await dbFor(brand).parentingLead.upsert({
    where: { email },
    create: { email, ...shared },
    update: { ...shared, planCount: { increment: 1 } },
  })
}

// ── Everything the page needs, in one call ───────────────────────────────────

/** One child and everything recorded about them. */
export interface BabyRecordDTO {
  profile: BabyProfileDTO
  /** Weight and height over time, oldest first. */
  measurements: BabyMeasurementDTO[]
  /** What this parent marked given or skipped, for THIS child. */
  vaccinations: BabyVaccinationDTO[]
}

export interface ParentingPayload {
  /** The published doses. Empty when the schedule has not been seeded. */
  schedule: VaccineDoseDTO[]
  /**
   * Every child on the account, each with their own record.
   *
   * Empty for a signed-out visitor — that is NOT "no children", it means the
   * browser store is the authority for them, and `signedIn` on the app's own
   * payload is what says which. It replaced a single `profile`, which is the
   * shape that made a second child overwrite the first.
   */
  babies: BabyRecordDTO[]
}

/**
 * One round trip for the whole surface.
 *
 * The page renders the schedule, the profile and the ticked doses together or
 * not at all, and three sequential awaits in a server component is three times
 * the latency for no benefit. `userId` is null for a guest, and the two
 * per-parent reads are skipped entirely rather than queried with a null key.
 */
export async function getParentingPayload(
  brand: Brand,
  userId: string | null,
): Promise<ParentingPayload> {
  const [schedule, babies, measurements, vaccinations] = await Promise.all([
    getVaccineSchedule(brand),
    userId ? listBabies(brand, userId) : Promise.resolve([]),
    // Grouped by child in one query each, so a parent with five children still
    // costs four round trips rather than 1 + 2n.
    userId ? listMeasurementsByBaby(brand, userId) : Promise.resolve(new Map()),
    userId ? listVaccinationsByBaby(brand, userId) : Promise.resolve(new Map()),
  ])

  return {
    schedule,
    babies: babies.map((profile) => ({
      profile,
      measurements: measurements.get(profile.id) ?? [],
      vaccinations: vaccinations.get(profile.id) ?? [],
    })),
  }
}

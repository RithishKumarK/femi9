import 'server-only'
import type { DoseAgeUnit, VaccineTrack } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import { bloodGroupLabel, type BloodGroup } from '../parenting'

/**
 * Admin parenting service — the console side of Lumi9's parenting tools.
 *
 * Two surfaces, and they are here together because they are one screen:
 *
 * **The vaccination schedule.** Reference data a government revises. It used to
 * be a TypeScript array, so correcting a dose age meant a code change, a review
 * and a deploy — on a page that tells parents when to take a baby to a clinic.
 * Now it is rows, and this is what edits them.
 *
 * **The care-plan leads.** Every address a parent gave the tools to receive a
 * plan. The route used to send the email and keep nothing at all, so nobody at
 * Lumi9 could tell whether the feature was used once or ten thousand times.
 *
 * Read-side rows are shaped for the client here — ISO strings, no `Date`, no
 * Prisma enum a client component would have to translate — so the console page
 * consumes them straight from JSON without importing this `server-only` module.
 */

// ── The schedule ─────────────────────────────────────────────────────────────

export type DoseRow = {
  id: string
  code: string
  vaccine: string
  dose: string
  ageUnit: DoseAgeUnit
  ageValue: number
  tracks: VaccineTrack[]
  note: string | null
  position: number
  active: boolean
}

/**
 * Every dose, active or not — the opposite of the storefront read, which drops
 * inactive rows.
 *
 * A withdrawn dose has to stay visible HERE or it becomes unreachable: nothing
 * else in the console lists it, and the only way back would be a database
 * client. It is also the row a parent's history points at, so "gone from the
 * list" and "gone" must not be the same thing.
 */
export async function listDoses(brand: Brand): Promise<DoseRow[]> {
  const rows = await dbFor(brand).vaccineDose.findMany({
    orderBy: [{ position: 'asc' }, { code: 'asc' }],
  })
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    vaccine: r.vaccine,
    dose: r.dose,
    ageUnit: r.ageUnit,
    ageValue: r.ageValue,
    tracks: r.tracks,
    note: r.note,
    position: r.position,
    active: r.active,
  }))
}

export interface DoseInput {
  vaccine: string
  dose: string
  ageUnit: DoseAgeUnit
  ageValue: number
  tracks: VaccineTrack[]
  note?: string | null
  position?: number
  active?: boolean
}

/**
 * Edit one dose.
 *
 * `code` is deliberately NOT editable. It is the key every `BabyVaccination`
 * points at, so changing it would silently detach every parent's record of that
 * dose — the row would look edited and a thousand histories would quietly stop
 * matching anything. Correcting a code is a seed's job, where the consequence is
 * visible.
 */
export async function updateDose(
  brand: Brand,
  id: string,
  input: Partial<DoseInput>,
): Promise<DoseRow | null> {
  const prisma = dbFor(brand)
  const existing = await prisma.vaccineDose.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return null

  const row = await prisma.vaccineDose.update({
    where: { id },
    data: {
      ...(input.vaccine !== undefined ? { vaccine: input.vaccine.trim() } : {}),
      ...(input.dose !== undefined ? { dose: input.dose.trim() } : {}),
      ...(input.ageUnit !== undefined ? { ageUnit: input.ageUnit } : {}),
      ...(input.ageValue !== undefined ? { ageValue: input.ageValue } : {}),
      ...(input.tracks !== undefined ? { tracks: input.tracks } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  })

  return {
    id: row.id,
    code: row.code,
    vaccine: row.vaccine,
    dose: row.dose,
    ageUnit: row.ageUnit,
    ageValue: row.ageValue,
    tracks: row.tracks,
    note: row.note,
    position: row.position,
    active: row.active,
  }
}

/**
 * Add a dose the published schedule gained.
 *
 * `code` is supplied and unique. It is slugged rather than generated so it
 * reads like the seeded ones ("penta-1") and so a later re-seed of a corrected
 * table can match it instead of creating a duplicate beside it.
 */
export async function createDose(
  brand: Brand,
  input: DoseInput & { code: string },
): Promise<{ status: 'ok'; dose: DoseRow } | { status: 'duplicate' }> {
  const prisma = dbFor(brand)
  const code = input.code.trim().toLowerCase()

  const clash = await prisma.vaccineDose.findUnique({ where: { code }, select: { id: true } })
  if (clash) return { status: 'duplicate' }

  const row = await prisma.vaccineDose.create({
    data: {
      code,
      vaccine: input.vaccine.trim(),
      dose: input.dose.trim(),
      ageUnit: input.ageUnit,
      ageValue: input.ageValue,
      tracks: input.tracks,
      note: input.note?.trim() || null,
      // Appended, not inserted. Position orders a visit's doses within the same
      // due age; a new dose landing in the middle of an existing group would
      // reorder rows nobody touched.
      position: input.position ?? (await nextPosition(brand)),
      active: input.active ?? true,
    },
  })

  return {
    status: 'ok',
    dose: {
      id: row.id,
      code: row.code,
      vaccine: row.vaccine,
      dose: row.dose,
      ageUnit: row.ageUnit,
      ageValue: row.ageValue,
      tracks: row.tracks,
      note: row.note,
      position: row.position,
      active: row.active,
    },
  }
}

async function nextPosition(brand: Brand): Promise<number> {
  const last = await dbFor(brand).vaccineDose.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  return (last?.position ?? -1) + 1
}

// ── The leads ────────────────────────────────────────────────────────────────

export type LeadRow = {
  id: string
  email: string
  babyName: string | null
  /** `YYYY-MM-DD`, or null. A `@db.Date` column, read in UTC as it was written. */
  dob: string | null
  sex: 'male' | 'female' | null
  bloodGroup: BloodGroup | null
  source: string | null
  /** Whether the parent had an account when they asked. */
  registered: boolean
  planCount: number
  lastSentAt: string
  createdAt: string
}

/**
 * Care-plan leads, newest first.
 *
 * `take` is capped rather than paginated, deliberately: this is a list somebody
 * scans or exports, not one they page through, and an uncapped `findMany` on a
 * table that only grows is the query that eventually takes the console down.
 * Add real pagination when the cap is reached, not before.
 */
export async function listParentingLeads(
  brand: Brand,
  { take = 200 }: { take?: number } = {},
): Promise<LeadRow[]> {
  const rows = await dbFor(brand).parentingLead.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(take, 1), 500),
  })

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    babyName: r.babyName,
    dob: r.dob ? r.dob.toISOString().slice(0, 10) : null,
    sex: r.sex,
    // The stored enum member is `A_POS`; the label is `A+`. Through the SHARED
    // translation, not a second copy of it — a console that prints `A_POS` at
    // somebody is a console with a leak in it.
    bloodGroup: bloodGroupLabel(r.bloodGroup),
    source: r.source,
    // Whether they had an account when they asked — the difference between a
    // shopper and a stranger. The `userId` itself is deliberately NOT sent: the
    // console has no screen that would use it, and a customer id on a marketing
    // list is a join nobody asked for.
    registered: r.userId !== null,
    planCount: r.planCount,
    lastSentAt: r.lastSentAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }))
}

/** Headline numbers for the page's stat row. */
export async function parentingStats(brand: Brand): Promise<{
  doses: number
  activeDoses: number
  leads: number
  /** Children — a parent with three siblings contributes three. */
  babies: number
  /** Accounts that have at least one child. */
  families: number
}> {
  const prisma = dbFor(brand)
  const [doses, activeDoses, leads, babies, families] = await Promise.all([
    prisma.vaccineDose.count(),
    prisma.vaccineDose.count({ where: { active: true } }),
    prisma.parentingLead.count(),
    // Children, and separately the accounts they belong to.
    //
    // These were ONE number, commented as "how many shoppers have actually
    // saved a baby" — true while `BabyProfile.userId` was unique and one row
    // meant one family. It stopped being true the moment a parent could add a
    // second child, and the number it had always meant (are the tools used by
    // people who came back?) would have quietly inflated by however many
    // siblings existed. Counting both keeps the old meaning available and adds
    // the new one rather than silently redefining it.
    prisma.babyProfile.count(),
    prisma.babyProfile
      .findMany({ distinct: ['userId'], select: { userId: true } })
      .then((rows) => rows.length),
  ])
  return { doses, activeDoses, leads, babies, families }
}

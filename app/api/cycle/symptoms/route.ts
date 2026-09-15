import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, created, handle, notFound, ok, serviceUnavailable, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import {
  CycleConsentRequiredError,
  FutureDateError,
  cycleStorageReady,
  deleteSymptom,
  logSymptom,
  updateSymptom,
} from '@femi9/core/services/cycle'

/**
 * /api/cycle/symptoms — how the user felt on a given day.
 *
 * POST accepts a whole day at once (`entries: [{ symptom, level }]`) because
 * symptom logging is genuinely multi-select: cramps AND low energy AND poor
 * sleep is one afternoon, not three separate visits to the form. The older
 * single-symptom body is still accepted so nothing that predates this breaks.
 *
 * `clientToday` carries the browser's own local day — see the periods route for
 * why the server's UTC date is the wrong reference in IST.
 */
const DayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')

const Entry = z.object({
  symptom: z.string().trim().min(1).max(40),
  level: z.number().int().min(0).max(3),
})

const PostSchema = z
  .object({
    date: DayKey,
    entries: z.array(Entry).min(1).max(12).optional(),
    // Legacy single-entry form.
    symptom: z.string().trim().min(1).max(40).optional(),
    level: z.number().int().min(0).max(3).optional(),
    note: z.string().trim().max(500).optional(),
    clientToday: DayKey.optional(),
  })
  .refine((v) => (v.entries && v.entries.length > 0) || (v.symptom && v.level != null), {
    message: 'Pick at least one symptom',
    path: ['entries'],
  })

const PatchSchema = z.object({
  id: z.string().min(1),
  date: DayKey.optional(),
  symptom: z.string().trim().min(1).max(40).optional(),
  level: z.number().int().min(0).max(3).optional(),
  clientToday: DayKey.optional(),
})

function mapError(err: unknown) {
  if (err instanceof CycleConsentRequiredError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
  }
  if (err instanceof FutureDateError) return badRequest(err.message)
  return null
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    if (!cycleStorageReady()) return serviceUnavailable('Cycle tracking is temporarily unavailable.')

    const parsed = PostSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    const { date, note, clientToday } = parsed.data
    const entries =
      parsed.data.entries ??
      (parsed.data.symptom && parsed.data.level != null
        ? [{ symptom: parsed.data.symptom, level: parsed.data.level }]
        : [])

    try {
      // Written one row per symptom so each is independently deletable from the
      // dashboard list. The optional note rides along on every row of the day.
      for (const entry of entries) {
        await logSymptom('femi9', u.sub, date, entry.symptom, entry.level, clientToday, note)
      }
      return created({ ok: true, count: entries.length })
    } catch (err) {
      const mapped = mapError(err)
      if (mapped) return mapped
      throw err
    }
  })
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    if (!cycleStorageReady()) return serviceUnavailable('Cycle tracking is temporarily unavailable.')

    const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    try {
      const { id, clientToday, ...patch } = parsed.data
      const updated = await updateSymptom('femi9', u.sub, id, patch, clientToday)
      return updated ? ok({ ok: true }) : notFound('That entry no longer exists.')
    } catch (err) {
      const mapped = mapError(err)
      if (mapped) return mapped
      throw err
    }
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const u = await requireUser('femi9')
    if (!u) return unauthorized()
    const id = req.nextUrl.searchParams.get('id')?.trim()
    if (!id) return badRequest('Symptom id is required')
    const deleted = await deleteSymptom('femi9', u.sub, id)
    return deleted ? ok({ ok: true }) : notFound('That entry no longer exists.')
  })
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, created, handle, notFound, ok, serviceUnavailable, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import {
  CycleConsentRequiredError,
  FutureDateError,
  cycleStorageReady,
  deletePeriod,
  logPeriod,
  updatePeriod,
} from '@femi9/core/services/cycle'

/**
 * /api/cycle/periods — the signed-in user's logged period starts.
 *
 * `clientToday` is the browser's own local day key. The server used to validate
 * "is this in the future?" against its UTC date, which in IST is yesterday until
 * 05:30 — so a user logging a period just after midnight was told her own date
 * hadn't happened yet, and the landing tracker silently swallowed the 400. The
 * service now compares against the client's day with a ±1 tolerance.
 */
const DayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')

const CreateSchema = z.object({
  startDate: DayKey,
  // Period length in days — clamped to a sane menstrual range.
  lengthDays: z.number().int().min(1).max(15),
  clientToday: DayKey.optional(),
})

const UpdateSchema = CreateSchema.extend({ id: z.string().min(1) })

/** Map the service's typed refusals onto the documented status codes. The
 *  `code` key is what the dashboard branches on to re-show the consent card. */
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

    const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    try {
      const { startDate, lengthDays, clientToday } = parsed.data
      const result = await logPeriod('femi9', u.sub, startDate, lengthDays, clientToday)
      // A repeat submission of the same day corrects the existing row rather
      // than adding a second one, so it is a 200, not a 201.
      return result.deduped ? ok({ ok: true, id: result.id, deduped: true }) : created({ ok: true, id: result.id })
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

    const parsed = UpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    try {
      const { id, startDate, lengthDays, clientToday } = parsed.data
      const updated = await updatePeriod('femi9', u.sub, id, startDate, lengthDays, clientToday)
      return updated ? ok({ ok: true }) : notFound('That logged period no longer exists.')
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
    if (!id) return badRequest('Period id is required')
    const deleted = await deletePeriod('femi9', u.sub, id)
    return deleted ? ok({ ok: true }) : notFound('That logged period no longer exists.')
  })
}

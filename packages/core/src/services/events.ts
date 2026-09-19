import 'server-only'
import type { Prisma } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Analytics write path. Deliberately fire-and-forget: telemetry is not part of
 * a request's contract, so a failed insert must never surface to — or roll back —
 * the originating request. Every error is logged and swallowed.
 */
export interface LogEventInput {
  type: string
  userId?: string | null
  meta?: unknown
}

export async function logEvent(brand: Brand, { type, userId, meta }: LogEventInput): Promise<void> {
  const prisma = dbFor(brand)
  try {
    await prisma.eventLog.create({
      data: {
        type,
        userId: userId ?? null,
        // undefined leaves the nullable Json column NULL rather than storing JSON null.
        meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
  } catch (err) {
    console.error('[events] failed to log event', err)
  }
}

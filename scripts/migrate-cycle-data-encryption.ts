import { PrismaClient } from '@prisma/client'
import { encryptCyclePayload } from '@femi9/core/cycle-crypto'

const prisma = new PrismaClient()

type LegacyPeriod = {
  id: string
  startDate: Date
  lengthDays: number
}

type LegacySymptom = {
  id: string
  date: Date
  symptom: string
  level: number
}

const dateKey = (value: Date) => {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 10)
}

async function main() {
  // The transaction-level advisory lock makes this safe when several ECS tasks
  // start concurrently during a rollout.
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(70490001)')

      // Idempotent compatibility DDL for the pre-migration production database.
      await tx.$executeRawUnsafe(
        'ALTER TABLE "PeriodLog" ADD COLUMN IF NOT EXISTS "encryptedData" TEXT',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "PeriodLog" ALTER COLUMN "startDate" DROP NOT NULL',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "PeriodLog" ALTER COLUMN "lengthDays" DROP NOT NULL',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "SymptomLog" ADD COLUMN IF NOT EXISTS "encryptedData" TEXT',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "SymptomLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "SymptomLog" ALTER COLUMN "date" DROP NOT NULL',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "SymptomLog" ALTER COLUMN "symptom" DROP NOT NULL',
      )
      await tx.$executeRawUnsafe(
        'ALTER TABLE "SymptomLog" ALTER COLUMN "level" DROP NOT NULL',
      )

      const periods = await tx.$queryRawUnsafe<LegacyPeriod[]>(
        'SELECT "id", "startDate", "lengthDays" FROM "PeriodLog" WHERE "encryptedData" IS NULL AND "startDate" IS NOT NULL AND "lengthDays" IS NOT NULL',
      )
      for (const row of periods) {
        const encrypted = encryptCyclePayload({
          kind: 'period',
          start: dateKey(row.startDate),
          length: row.lengthDays,
        })
        await tx.$executeRaw`
          UPDATE "PeriodLog"
          SET "encryptedData" = ${encrypted}, "startDate" = NULL, "lengthDays" = NULL
          WHERE "id" = ${row.id} AND "encryptedData" IS NULL
        `
      }

      const symptoms = await tx.$queryRawUnsafe<LegacySymptom[]>(
        'SELECT "id", "date", "symptom", "level" FROM "SymptomLog" WHERE "encryptedData" IS NULL AND "date" IS NOT NULL AND "symptom" IS NOT NULL AND "level" IS NOT NULL',
      )
      for (const row of symptoms) {
        const encrypted = encryptCyclePayload({
          kind: 'symptom',
          date: dateKey(row.date),
          symptom: row.symptom,
          level: row.level,
        })
        await tx.$executeRaw`
          UPDATE "SymptomLog"
          SET "encryptedData" = ${encrypted}, "date" = NULL, "symptom" = NULL, "level" = NULL
          WHERE "id" = ${row.id} AND "encryptedData" IS NULL
        `
      }

      return { periods: periods.length, symptoms: symptoms.length }
    },
    { maxWait: 10_000, timeout: 120_000 },
  )

  console.info(
    JSON.stringify({
      event: 'cycle_data_encryption_migrated',
      ...result,
      t: new Date().toISOString(),
    }),
  )
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: 'cycle_data_encryption_migration_failed',
        error: error instanceof Error ? error.message : String(error),
        t: new Date().toISOString(),
      }),
    )
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())

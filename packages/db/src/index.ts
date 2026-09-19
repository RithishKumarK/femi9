import { PrismaClient } from '@prisma/client'

/**
 * The platform's database access layer.
 *
 * One Prisma schema serves BOTH brands. Isolation is not a `where` clause that
 * somebody can forget — it lives in the connection string: each brand gets its
 * own client bound to its own Postgres schema, so a query issued on the Femi9
 * client cannot reach a Lumi9 row at all.
 *
 * See apps/femi9-web/docs/TWO-BRAND-ARCHITECTURE.md for why this shape was
 * chosen over a `brand` discriminator column.
 */

// ─────────────────────────────── Brands ────────────────────────────────

export const BRANDS = ['femi9', 'lumi9'] as const
export type Brand = (typeof BRANDS)[number]

/**
 * Narrow untrusted input to a Brand. Anything arriving from a request — a form
 * field, a query param, the admin login's brand toggle — MUST come through
 * here. It deliberately has no default: falling back to a brand on bad input is
 * how one brand's console ends up reading another's data.
 */
export function isBrand(value: unknown): value is Brand {
  return typeof value === 'string' && (BRANDS as readonly string[]).includes(value)
}

// ──────────────────────────── Connections ─────────────────────────────

/**
 * Interactive-transaction budget. Prisma's 5s default is sized for a database
 * one network hop away, which is what production is (Fargate → RDS Proxy →
 * Aurora, same VPC, sub-millisecond). It is NOT what a developer running the
 * integration suite against a hosted Postgres has: at ~250ms per round trip,
 * checkout's order transaction — a dozen sequential statements — spends its
 * whole budget on latency and dies with "Transaction already closed" partway
 * through reserving stock, which reads like an oversell bug rather than a slow
 * link. Configurable so the test env can buy headroom without loosening the
 * production ceiling that keeps a stuck transaction from pinning a connection.
 */
const TRANSACTION_TIMEOUT_MS = Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS) || 5_000

/**
 * Resolve a brand's connection string.
 *
 * `DATABASE_URL_FEMI9` / `DATABASE_URL_LUMI9` are the destination: one Postgres
 * instance, one schema per brand, selected with `?schema=`.
 *
 * The `DATABASE_URL` fallback is TRANSITIONAL. Today there is still a single
 * database holding Femi9 in the `public` schema, and nothing has been renamed —
 * Phase 2 does that. Until then Femi9 keeps reading the variable it always has,
 * so this refactor changes no deployment config. Lumi9 has no fallback on
 * purpose: it must not silently borrow Femi9's database.
 */
function connectionUrlFor(brand: Brand): string {
  const perBrand = process.env[`DATABASE_URL_${brand.toUpperCase()}`]
  if (perBrand) return perBrand

  if (brand === 'femi9' && process.env.DATABASE_URL) return process.env.DATABASE_URL

  throw new Error(
    `No database URL for brand "${brand}". Set DATABASE_URL_${brand.toUpperCase()}.`,
  )
}

/**
 * Clients are cached per brand on globalThis. Without the global cache, Next dev
 * would spawn a new pool on every hot reload and exhaust connections — the same
 * reason the single-client version cached, now keyed by brand because one
 * process can legitimately hold a client per brand (the admin console does).
 */
const globalForPrisma = globalThis as unknown as {
  prismaByBrand?: Map<Brand, PrismaClient>
}

const clients = (globalForPrisma.prismaByBrand ??= new Map<Brand, PrismaClient>())

/**
 * The brand's Prisma client. Memoised, so calling this per request is free.
 *
 * Every service takes `brand` as its first parameter and resolves its client
 * through here. Brand must come from the session or the host — never from a
 * request body or query param a caller can set.
 */
export function dbFor(brand: Brand): PrismaClient {
  const existing = clients.get(brand)
  if (existing) return existing

  const client = new PrismaClient({
    datasourceUrl: connectionUrlFor(brand),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    transactionOptions: { timeout: TRANSACTION_TIMEOUT_MS },
  })

  clients.set(brand, client)
  return client
}

/** Disconnect every open client. For test teardown and one-off scripts. */
export async function disconnectAll(): Promise<void> {
  await Promise.all([...clients.values()].map((client) => client.$disconnect()))
  clients.clear()
}

// Re-exported so consumers get their model types and enums from the same place
// they get their client, rather than reaching for @prisma/client separately.
export * from '@prisma/client'
export { PrismaClient }

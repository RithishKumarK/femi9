import { PrismaClient } from '../generated/client'

/**
 * The platform database: admin identity, brand membership, and the audit trail.
 *
 * Separate from either brand's client on purpose. `dbFor(brand)` hands out a
 * connection bound to one brand's Postgres schema; this one is bound to
 * `platform`, which neither brand's client can reach. A compromised or
 * mis-scoped brand query cannot read the credentials guarding the other brand.
 */

const globalForPlatform = globalThis as unknown as { platformDb?: PrismaClient }

function connectionUrl(): string {
  const url = process.env.DATABASE_URL_PLATFORM
  if (!url) {
    throw new Error(
      'DATABASE_URL_PLATFORM is not set. The admin console cannot authenticate anyone without it.',
    )
  }
  return url
}

/**
 * The platform client. Memoised on globalThis for the same reason the brand
 * clients are: without it, Next dev spawns a fresh pool on every hot reload and
 * exhausts connections.
 *
 * Resolved lazily by the caller — see the note in the admin app's db module
 * about the Docker build stage having no credentials.
 */
export function platformDb(): PrismaClient {
  if (globalForPlatform.platformDb) return globalForPlatform.platformDb

  const client = new PrismaClient({
    datasourceUrl: connectionUrl(),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

  globalForPlatform.platformDb = client
  return client
}

/** For test teardown and one-off scripts. */
export async function disconnectPlatform(): Promise<void> {
  if (globalForPlatform.platformDb) {
    await globalForPlatform.platformDb.$disconnect()
    globalForPlatform.platformDb = undefined
  }
}

export * from '../generated/client'
export { PrismaClient }

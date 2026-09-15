/**
 * `@femi9/db` stand-in.
 *
 * The real package owns the Prisma schema (~60 models) and hands out one client
 * per brand from one connection string. Neither the schema nor a generated
 * client exists in this standalone copy, so `dbFor` cannot return anything: it
 * throws, and every caller that genuinely needs Postgres fails loudly at the
 * first query rather than rendering half a page of wrong numbers.
 */

import { unavailable } from '../core/_unavailable'

export type Brand = 'femi9' | 'lumi9'

export function isBrand(value: unknown): value is Brand {
  return value === 'femi9' || value === 'lumi9'
}

/**
 * Loose stand-in for `PrismaClient`. It has to be an object type rather than
 * `never`, because `src/lib/db.ts` types its lazy proxy as `ReturnType<typeof
 * dbFor>` and a `never` there would poison all ~18 of its call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = Record<string, any>

export function dbFor(_brand: Brand): Db {
  return unavailable('The Prisma client (@femi9/db)')
}

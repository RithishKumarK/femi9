import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../brands'

/**
 * Group-level reporting across both brands.
 *
 * The brands live in separate Postgres schemas, so this reads each and merges
 * in application code rather than joining. That is the one cost of schema-per-
 * brand, and it is paid here, once, on a dashboard — not on any hot path. A
 * discriminator column would have made this a single query and made every
 * OTHER query a place a leak could hide.
 *
 * Reads are per brand and the caller decides which brands to ask for, so an
 * admin who holds a role in only one never has the other's numbers computed,
 * let alone rendered.
 */

export interface BrandTotals {
  brand: Brand
  name: string
  accent: string
  /** Paid orders only — pending ones are not revenue. */
  paidOrders: number
  revenue: number
  /** Orders placed but not yet paid, which is a queue rather than income. */
  pendingOrders: number
  customers: number
  activeProducts: number
  /** Variants at or below this many units, as a restock signal. */
  lowStock: number
}

export interface GroupOverview {
  brands: BrandTotals[]
  totals: { paidOrders: number; revenue: number; customers: number }
  /** Brands the caller asked for but which could not be read — a missing
   *  DATABASE_URL, or a schema not migrated yet. Reported rather than swallowed
   *  so a zero is never mistaken for "no sales". */
  unavailable: Brand[]
}

const LOW_STOCK_AT = 40

async function totalsFor(brand: Brand): Promise<BrandTotals> {
  const db = dbFor(brand)
  const config = brandConfig(brand)

  const [paid, pending, customers, activeProducts, lowStock] = await Promise.all([
    db.order.aggregate({ where: { status: { in: ['paid', 'processing', 'shipped', 'delivered'] } }, _sum: { total: true }, _count: true }),
    db.order.count({ where: { status: 'pending' } }),
    db.user.count({ where: { role: 'customer' } }),
    db.product.count({ where: { status: 'active' } }),
    db.productVariant.count({ where: { active: true, stock: { lte: LOW_STOCK_AT } } }),
  ])

  return {
    brand,
    name: config.name,
    accent: config.accent,
    paidOrders: paid._count,
    revenue: paid._sum.total ?? 0,
    pendingOrders: pending,
    customers,
    activeProducts,
    lowStock,
  }
}

/**
 * Totals for the given brands.
 *
 * A brand that cannot be read is reported in `unavailable` rather than throwing:
 * before the second brand's database exists, the group view should still show
 * the first one's numbers and say plainly that the other is not reporting.
 */
export async function getGroupOverview(brands: Brand[]): Promise<GroupOverview> {
  const settled = await Promise.allSettled(brands.map(totalsFor))

  const rows: BrandTotals[] = []
  const unavailable: Brand[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') rows.push(result.value)
    else unavailable.push(brands[index]!)
  })

  return {
    brands: rows,
    totals: {
      paidOrders: rows.reduce((sum, r) => sum + r.paidOrders, 0),
      revenue: rows.reduce((sum, r) => sum + r.revenue, 0),
      customers: rows.reduce((sum, r) => sum + r.customers, 0),
    },
    unavailable,
  }
}

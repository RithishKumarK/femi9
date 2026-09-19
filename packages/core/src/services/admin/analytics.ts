import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import type { OrderStatus } from '@prisma/client'

/**
 * Admin dashboard analytics — read-only aggregations for the /admin overview.
 *
 * All numbers are money in whole rupees (Order.total etc. are integer rupees).
 *
 * "Revenue" deliberately excludes orders that never became money — pending
 * (unpaid), cancelled and refunded — so the KPI tiles, the revenue trend and
 * the geography ranking all agree on the same denominator. `ordersByStatus`
 * (the pipeline view) is the one place we count EVERY status, so the admin can
 * still see what's stuck or was refunded.
 */

// Statuses that represent captured/committed revenue (paid onward).
const REVENUE_STATUSES: OrderStatus[] = ['paid', 'processing', 'shipped', 'delivered']

// Trailing months shown in the revenue trend (inclusive of the current month).
const MONTHS_BACK = 9

// A variant is "low stock" below this on-hand count (matches the inventory rule).
const LOW_STOCK_THRESHOLD = 40

export interface RevenueMonth {
  /** Short month label, e.g. "Aug". */
  label: string
  revenue: number
}

export interface StatusBreakdown {
  status: OrderStatus
  orders: number
  revenue: number
}

export interface TopProduct {
  /** Snapshot product name from the order line (survives catalog edits). */
  name: string
  units: number
  revenue: number
}

export interface CityStat {
  city: string
  orders: number
  revenue: number
}

export interface LowStockVariant {
  productName: string
  /** Product slug — links straight to the storefront/inventory row. */
  slug: string
  label: string
  sku: string | null
  stock: number
}

export interface Overview {
  totalRevenue: number
  orderCount: number
  customerCount: number
  avgOrderValue: number
  revenueByMonth: RevenueMonth[]
  ordersByStatus: StatusBreakdown[]
  topProducts: TopProduct[]
  ordersByCity: CityStat[]
  lowStockVariants: LowStockVariant[]
}

/** A stable month bucket key so orders map onto the trend regardless of year. */
function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth()
}

export async function getOverview(brand: Brand): Promise<Overview> {
  const prisma = dbFor(brand)
  const emptyOverview: Overview = {
    totalRevenue: 0,
    orderCount: 0,
    customerCount: 0,
    avgOrderValue: 0,
    revenueByMonth: [
      { label: 'Jan', revenue: 0 },
      { label: 'Feb', revenue: 0 },
      { label: 'Mar', revenue: 0 },
      { label: 'Apr', revenue: 0 },
      { label: 'May', revenue: 0 },
      { label: 'Jun', revenue: 0 },
      { label: 'Jul', revenue: 0 },
      { label: 'Aug', revenue: 0 },
    ],
    ordersByStatus: [],
    topProducts: [],
    ordersByCity: [],
    lowStockVariants: [],
  }

  try {
    const revenueWhere = { status: { in: REVENUE_STATUSES } }
    const now = new Date()
    const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1)

    const [
      revenueAgg,
      customerCount,
      trendOrders,
      statusGroups,
      topProductGroups,
      geoOrders,
      lowStock,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: revenueWhere,
        _sum: { total: true },
        _count: true,
      }).catch(() => ({ _sum: { total: 0 }, _count: 0 })),

      prisma.user.count({ where: { role: 'customer' } }).catch(() => 0),

      prisma.order.findMany({
        where: { ...revenueWhere, placedAt: { gte: windowStart } },
        select: { placedAt: true, total: true },
      }).catch(() => []),

      prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { total: true },
      }).catch(() => []),

      prisma.orderItem.groupBy({
        by: ['productName'],
        where: { order: { status: { in: REVENUE_STATUSES } } },
        _sum: { qty: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 6,
      }).catch(() => []),

      prisma.order.findMany({
        where: revenueWhere,
        select: { total: true, address: { select: { city: true } } },
      }).catch(() => []),

      prisma.productVariant.findMany({
        where: { active: true, stock: { lt: LOW_STOCK_THRESHOLD }, product: { status: { not: 'archived' } } },
        orderBy: { stock: 'asc' },
        select: {
          label: true,
          sku: true,
          stock: true,
          product: { select: { name: true, slug: true } },
        },
      }).catch(() => []),
    ])

    const totalRevenue = revenueAgg._sum?.total ?? 0
    const orderCount = revenueAgg._count ?? 0
    const avgOrderValue = orderCount ? Math.round(totalRevenue / orderCount) : 0

    const buckets: RevenueMonth[] = []
    const keyToPos = new Map<number, number>()
    for (let i = 0; i < MONTHS_BACK; i++) {
      const d = new Date(windowStart.getFullYear(), windowStart.getMonth() + i, 1)
      keyToPos.set(monthIndex(d), buckets.length)
      buckets.push({ label: d.toLocaleString('en-IN', { month: 'short' }), revenue: 0 })
    }
    for (const o of trendOrders) {
      const pos = keyToPos.get(monthIndex(o.placedAt))
      if (pos != null) buckets[pos].revenue += o.total
    }

    const ordersByStatus: StatusBreakdown[] = statusGroups
      .map((g) => ({
        status: g.status,
        orders: g._count._all,
        revenue: g._sum.total ?? 0,
      }))
      .sort((a, b) => b.orders - a.orders)

    const topProducts: TopProduct[] = topProductGroups.map((g) => ({
      name: g.productName,
      units: g._sum.qty ?? 0,
      revenue: g._sum.lineTotal ?? 0,
    }))

    const cityMap = new Map<string, CityStat>()
    for (const o of geoOrders) {
      const city = o.address?.city ?? 'Unknown'
      const row = cityMap.get(city) ?? { city, orders: 0, revenue: 0 }
      row.orders += 1
      row.revenue += o.total
      cityMap.set(city, row)
    }
    const ordersByCity = [...cityMap.values()].sort(
      (a, b) => b.orders - a.orders || b.revenue - a.revenue,
    )

    const lowStockVariants: LowStockVariant[] = lowStock.map((v) => ({
      productName: v.product.name,
      slug: v.product.slug,
      label: v.label,
      sku: v.sku,
      stock: v.stock,
    }))

    return {
      totalRevenue,
      orderCount,
      customerCount,
      avgOrderValue,
      revenueByMonth: buckets,
      ordersByStatus,
      topProducts,
      ordersByCity,
      lowStockVariants,
    }
  } catch {
    return emptyOverview
  }
}

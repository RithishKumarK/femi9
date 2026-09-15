/**
 * Seed realistic DEMO SALES DATA so the admin dashboard / orders / customers
 * modules have real rows to render (revenue, geography, customer list) BEFORE
 * the storefront checkout that writes real orders exists.
 *
 * This is a one-off script (run with `npx tsx prisma/seed-demo.ts`), NOT app
 * code — so `Math.random` / `new Date` are intentionally used here to spread
 * orders over time and vary amounts. It follows prisma/seed.ts: a plain
 * PrismaClient (Prisma auto-loads .env), no `server-only`.
 *
 * Idempotent: every demo customer's email ends in `@demo.femi9`. On each run we
 * first delete those users' orders (order items cascade) and then the users
 * (addresses + points ledger cascade), so re-runs start clean. The real seeded
 * products and the 2 real users (admin@femi9.in, the real customer) are never
 * touched.
 */
import { PrismaClient, type OrderStatus } from '@prisma/client'

const prisma = new PrismaClient()

const DEMO_EMAIL_SUFFIX = '@demo.femi9'

// ── small deterministic-enough helpers (randomness is fine in a seed script) ──
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
function sample<T>(arr: T[], n: number): T[] {
  // Fisher–Yates on a copy, take first n — gives DISTINCT items per order.
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, Math.min(n, a.length))
}

// Weighted order status matching the requested distribution.
function pickStatus(): OrderStatus {
  const r = Math.random()
  if (r < 0.65) return 'delivered'
  if (r < 0.8) return 'shipped'
  if (r < 0.92) return 'processing'
  return 'paid'
}

// Tamil Nadu cities with a representative base pincode.
const CITY_PIN: Record<string, string> = {
  Coimbatore: '641001',
  Erode: '638001',
  Chennai: '600001',
  Madurai: '625001',
  Tiruppur: '641601',
  Salem: '636001',
  Tiruchirappalli: '620001',
  Vellore: '632001',
  Tirunelveli: '627001',
  Thanjavur: '613001',
}

// ~14 demo customers spread across the cities above.
const CUSTOMERS: { name: string; city: string; tier: string | null }[] = [
  { name: 'Priya Raman', city: 'Coimbatore', tier: 'Bloom member' },
  { name: 'Divya Sundar', city: 'Erode', tier: 'Blossom member' },
  { name: 'Kavya Natarajan', city: 'Chennai', tier: 'Bloom member' },
  { name: 'Meena Krishnan', city: 'Madurai', tier: null },
  { name: 'Anitha Selvam', city: 'Tiruppur', tier: 'Sprout member' },
  { name: 'Lakshmi Venkat', city: 'Salem', tier: 'Bloom member' },
  { name: 'Deepa Murugan', city: 'Tiruchirappalli', tier: 'Blossom member' },
  { name: 'Revathi Prakash', city: 'Vellore', tier: null },
  { name: 'Sangeetha Rao', city: 'Tirunelveli', tier: 'Bloom member' },
  { name: 'Vidya Balaji', city: 'Thanjavur', tier: 'Sprout member' },
  { name: 'Nithya Gopal', city: 'Coimbatore', tier: 'Bloom member' },
  { name: 'Bhavani Shankar', city: 'Chennai', tier: 'Blossom member' },
  { name: 'Gayathri Mohan', city: 'Madurai', tier: null },
  { name: 'Saranya Kumar', city: 'Salem', tier: 'Bloom member' },
]

const STREETS = ['Gandhi Nagar', 'Nehru Street', 'Anna Salai', 'Bharathi Nagar', 'Kamaraj Road', 'RS Puram', 'Race Course', 'Town Hall Road']

const ORDER_COUNT = 55
const DAYS_BACK = 183 // ~6 months

async function cleanDemo() {
  const demo = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_SUFFIX } },
    select: { id: true },
  })
  const ids = demo.map((u) => u.id)
  if (ids.length === 0) {
    console.log('✓ no existing demo data to clean')
    return
  }
  // Order.userId is onDelete:SetNull, so orders would survive a user delete —
  // delete them explicitly first (OrderItems/Payments cascade off the order).
  const del = await prisma.order.deleteMany({ where: { userId: { in: ids } } })
  // Deleting the users cascades their addresses + points ledger rows.
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  console.log(`✓ cleaned demo data (${ids.length} users, ${del.count} orders)`)
}

async function main() {
  console.log('Seeding demo sales data…')
  await cleanDemo()

  // Real catalog to snapshot from. Only ACTIVE variants of active products.
  const variants = await prisma.productVariant.findMany({
    where: { active: true, product: { status: 'active' } },
    include: { product: true },
  })
  if (variants.length === 0) throw new Error('No product variants found — run the base seed first.')

  // ── Create demo customers, each with one primary Tamil Nadu address ──
  const customers: { id: string; addressId: string }[] = []
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const c = CUSTOMERS[i]
    const slug = c.name.toLowerCase().replace(/\s+/g, '.')
    const email = `${slug}${DEMO_EMAIL_SUFFIX}`
    const phone = `+9198${String(76500000 + i).padStart(8, '0')}` // unique 10-digit mobile
    const basePin = CITY_PIN[c.city]
    const pincode = String(Number(basePin) + randInt(0, 30))

    const user = await prisma.user.create({
      data: {
        name: c.name,
        email,
        phone,
        role: 'customer',
        tier: c.tier,
        addresses: {
          create: {
            label: 'Home',
            name: c.name,
            line: `${randInt(1, 120)}/${randInt(1, 40)}, ${pick(STREETS)}`,
            city: c.city,
            state: 'Tamil Nadu',
            pincode,
            phone,
            isPrimary: true,
          },
        },
      },
      include: { addresses: true },
    })
    customers.push({ id: user.id, addressId: user.addresses[0].id })
  }
  console.log(`✓ demo customers (${customers.length}) with addresses`)

  // ── Create orders spread over the last ~6 months ──
  // Continue any existing FM- numbering so orderNo stays unique even if some
  // FM- orders survived outside the demo set (there normally are none).
  const existingFm = await prisma.order.findMany({
    where: { orderNo: { startsWith: 'FM-' } },
    select: { orderNo: true },
  })
  let counter = existingFm.reduce((m, o) => Math.max(m, Number(o.orderNo.slice(3)) || 0), 0)

  let revenue = 0
  let itemCount = 0
  const statusTally: Record<string, number> = {}

  for (let n = 0; n < ORDER_COUNT; n++) {
    const owner = pick(customers)
    const chosen = sample(variants, randInt(1, 3))
    const items = chosen.map((v) => {
      const qty = randInt(1, 3)
      return {
        variantId: v.id,
        productName: v.product.name,
        variantLabel: v.label,
        unitPrice: v.price,
        qty,
        lineTotal: v.price * qty,
      }
    })
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0)
    const shipping = subtotal >= 999 ? 0 : 49 // free shipping over Rs.999
    const discount = 0
    const total = subtotal + shipping - discount

    const status = pickStatus()
    statusTally[status] = (statusTally[status] ?? 0) + 1

    // Random moment within the last ~6 months.
    const placedAt = new Date(Date.now() - randInt(0, DAYS_BACK) * 86_400_000 - randInt(0, 86_399_000))

    counter += 1
    const orderNo = `FM-${String(counter).padStart(5, '0')}`

    await prisma.order.create({
      data: {
        orderNo,
        userId: owner.id,
        addressId: owner.addressId,
        status,
        subtotal,
        discount,
        shipping,
        total,
        channel: 'web',
        placedAt,
        items: { create: items },
      },
    })

    revenue += total
    itemCount += items.length
  }
  console.log(`✓ demo orders (${ORDER_COUNT}) — status ${JSON.stringify(statusTally)}`)

  // ── Opening loyalty balance for a few customers (dashboard loyalty widgets) ──
  const loyaltyFor = customers.slice(0, 6)
  for (const c of loyaltyFor) {
    const opening = randInt(1, 8) * 50 // 50..400 points
    await prisma.pointsLedger.create({
      data: { userId: c.id, delta: opening, reason: 'Opening balance (demo)', balanceAfter: opening },
    })
  }
  console.log(`✓ opening points ledger (${loyaltyFor.length} customers)`)

  // ── Summary ──
  console.log('\n── Summary ──')
  console.log(`Demo customers : ${customers.length}`)
  console.log(`Orders         : ${ORDER_COUNT}`)
  console.log(`Order items    : ${itemCount}`)
  console.log(`Points rows    : ${loyaltyFor.length}`)
  console.log(`Total revenue  : Rs.${revenue.toLocaleString('en-IN')}`)
  console.log('Status split   :', statusTally)
  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

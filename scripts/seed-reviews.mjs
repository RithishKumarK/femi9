/**
 * Seed sample product reviews into a chosen database.
 *
 * Usage
 * ─────
 *   SEED_DATABASE_URL="postgresql://…" node scripts/seed-reviews.mjs
 *   SEED_DATABASE_URL="postgresql://…" node scripts/seed-reviews.mjs --wipe
 *
 * The connection string is read from SEED_DATABASE_URL and NOT from .env's
 * DATABASE_URL, deliberately: this script writes rows that will be shown to
 * shoppers as other people's opinions, and defaulting it to whatever the app is
 * currently pointed at is how that ends up in production by accident. There is
 * no default — omit the variable and it refuses to run.
 *
 * Every row it writes carries `place: 'SAMPLE'`, which is both the marker the
 * --wipe flag matches on and a visible tell in the admin console that the review
 * is not from a real customer. Re-running is safe: existing SAMPLE rows for a
 * product are replaced, never duplicated.
 *
 * Reviews are created `approved` so they appear immediately — the whole point is
 * to populate a staging storefront. Genuine shopper submissions still land as
 * `pending` through the normal API path.
 */
import { PrismaClient } from '@prisma/client'

const url = process.env.SEED_DATABASE_URL?.trim()
if (!url) {
  console.error(
    'SEED_DATABASE_URL is not set.\n' +
      'Point it at the database you want seeded, e.g.\n' +
      '  SEED_DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node scripts/seed-reviews.mjs',
  )
  process.exit(1)
}

const WIPE_ONLY = process.argv.includes('--wipe')

/** Guard against the most common accident: seeding the live shop. */
if (/prod/i.test(url) && !process.argv.includes('--i-know-this-is-production')) {
  console.error(
    'Refusing to run: the connection string looks like production.\n' +
      'Re-run with --i-know-this-is-production if that is genuinely what you want.',
  )
  process.exit(1)
}

const prisma = new PrismaClient({ datasourceUrl: url })

/** The tell that a row came from this script rather than a customer. */
const MARKER = 'SAMPLE'

/**
 * Reviews keyed by product slug. Written to sound like the customers this brand
 * actually has — specific about fit, absorbency and skin reaction rather than
 * generic praise, because a wall of "Great product!!" is worse than no reviews
 * at all for judging whether the section works.
 */
const BY_SLUG = {
  p330dw: [
    ['Divya', 5, 'Finally no rashes', 'I have sensitive skin and every other brand left me itching by day two. Switched to the 330mm overnight pads last cycle and there was no irritation at all, even on the heaviest night. The cotton top sheet genuinely feels like cloth rather than plastic.'],
    ['Priya', 5, 'Worth every rupee', 'Slept through the night with zero leaks. The double wings actually hold.'],
    ['Anitha', 4, 'Great pad, wish the pack was bigger', 'Absorbency and comfort are both excellent and I would happily recommend these. My only complaint is that nine pads does not quite cover a full cycle for me, so I end up ordering two packs.'],
    ['Meera', 5, 'The anion strip actually helps', 'I was sceptical about the anion strip but cramps were noticeably milder this cycle.'],
    ['Sowmya', 4, 'Good for heavy days', 'Held up through a long train journey without shifting. Slightly thicker than I expected but that is the trade-off for the coverage.'],
    ['Reshma', 5, 'No smell at all', 'What surprised me most was that there was no odour by the end of the day. Ordering again.'],
  ],
  p330cw: [
    ['Lakshmi', 5, 'The wide back is the difference', 'I sleep on my side and always woke up to back stains with other brands. The fan-shaped rear panel solved it in one cycle.'],
    ['Nithya', 4, 'Comfortable overnight', 'Centre wings sit flat and do not bunch. Took me one night to get used to the placement.'],
    ['Aarthi', 5, 'No more night anxiety', 'Eight hours, no leak, no rash. That is all I wanted.'],
    ['Bhavana', 5, 'Soft and breathable', 'Does not feel sweaty even in Chennai heat, which is genuinely rare for an overnight pad.'],
  ],
  p290l9: [
    ['Keerthi', 5, 'My everyday pad now', 'Light enough that I forget it is there, absorbent enough for day two. Replaced my regular brand entirely.'],
    ['Swathi', 4, 'Very soft', 'The top sheet is lovely. Wings could be a touch longer for my liking but no complaints otherwise.'],
    ['Divyashree', 5, 'No rash after three cycles', 'I get a rash from almost everything. Three cycles in and nothing. That alone earns five stars.'],
    ['Hema', 4, 'Good value', 'Nine pads at this price with organic cotton is fair. Delivery was quick and packaging was discreet.'],
    ['Janani', 5, 'Stays in place at the gym', 'Wore it through a workout and it did not shift at all.'],
  ],
  p290l3: [
    ['Sneha', 5, 'Perfect way to try', 'Three pads was exactly enough to know I wanted the full pack. No commitment and the quality is identical.'],
    ['Ramya', 4, 'Good starter', 'Fits in a handbag easily. Wish the trial had a night pad in it too.'],
    ['Vaishnavi', 5, 'Convinced me', 'Ordered the trial, ordered the nine pack the same week.'],
  ],
  ppanty: [
    ['Anusha', 5, 'Feels like normal underwear', 'I expected bulk and there is none. Wore it on a light day with no pad at all and stayed dry.'],
    ['Preethi', 4, 'Takes a rinse routine', 'Absorbency is genuinely good. You do need to rinse it straight away, which is a small habit to build.'],
    ['Kavitha', 5, 'Saved me on travel', 'Two of these got me through a four-day trip with far less to carry.'],
    ['Deepa', 4, 'Holds up in the wash', 'Ten-plus washes and the fabric has not thinned or lost shape.'],
  ],
  p180m9: [
    ['Harini', 5, 'Genuinely ultra thin', 'You cannot feel it. I use them on the last day and for daily discharge.'],
    ['Malini', 4, 'Sticks properly', 'The full-length adhesive means no bunching, which was my problem with cheaper liners.'],
    ['Shruti', 5, 'Great for everyday', 'Thirty in a pack lasts me well over a month. Breathable and no irritation.'],
  ],
}

/** Spread createdAt over the past few months so the dates do not all read alike. */
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000)
}

async function main() {
  const products = await prisma.product.findMany({ select: { id: true, slug: true, name: true } })
  const bySlug = new Map(products.map((p) => [p.slug, p]))
  console.log(`Connected. ${products.length} products found.`)

  const removed = await prisma.review.deleteMany({ where: { place: MARKER } })
  console.log(`Removed ${removed.count} existing ${MARKER} review(s).`)
  if (WIPE_ONLY) {
    console.log('--wipe given, so stopping here.')
    return
  }

  let written = 0
  let dayOffset = 3
  for (const [slug, rows] of Object.entries(BY_SLUG)) {
    const product = bySlug.get(slug)
    if (!product) {
      console.warn(`  skip ${slug} - no such product in this database`)
      continue
    }
    await prisma.review.createMany({
      data: rows.map(([name, rating, title, body]) => {
        // Step the dates apart so the carousel does not show one repeated date.
        dayOffset += 4 + (rating % 3)
        return {
          productId: product.id,
          name,
          place: MARKER,
          rating,
          title,
          body,
          status: 'approved',
          createdAt: daysAgo(dayOffset),
          // Seeded reviews are never "verified buyers": that badge is derived
          // from a real paid order, and faking it would put a trust signal on
          // the page that nothing backs.
          helpfulUp: (rating * 3 + title.length) % 17,
          helpfulDown: title.length % 3,
        }
      }),
    })
    written += rows.length
    console.log(`  ${product.name}: ${rows.length} review(s)`)
  }

  console.log(`\nDone. ${written} review(s) written, all marked place='${MARKER}'.`)
  console.log(`Remove them again with:  SEED_DATABASE_URL=… node scripts/seed-reviews.mjs --wipe`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

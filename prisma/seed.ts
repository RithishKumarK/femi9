/**
 * Seed only public catalog and editorial content.
 *
 * Included:
 * - products, variants and their one catalog image
 * - blog categories and blog posts
 * - subscription cadences (reference data the subscribe flow resolves against,
 *   not demo content — without them every subscribe attempt 400s)
 *
 * Deliberately excluded: users, reviews, rewards, orders, subscriptions,
 * settings, community posts and analytics/demo activity.
 */
import { PrismaClient } from '@prisma/client'
import { PRODUCTS, CADENCES } from '../src/data/products'
import { POSTS, CATEGORY_META } from '../src/data/blog'

const prisma = new PrismaClient()

async function seedBlogCategories() {
  const entries = Object.entries(CATEGORY_META)
  for (const [name, meta] of entries) {
    await prisma.blogCategory.upsert({
      where: { name },
      create: { name, color: meta.color, tint: meta.tint },
      update: { color: meta.color, tint: meta.tint },
    })
  }
  console.log(`Seeded blog categories (${entries.length})`)
}

async function seedProducts() {
  for (const source of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { slug: source.id },
      create: {
        slug: source.id,
        name: source.name,
        type: source.type ?? 'pad',
        basePrice: source.price,
        meta: source.meta,
        flow: source.flow,
        description: source.desc,
        tag: source.tag,
        tagClass: source.tagClass,
        rating: 0,
        reviewCount: 0,
      },
      update: {
        name: source.name,
        type: source.type ?? 'pad',
        basePrice: source.price,
        meta: source.meta,
        flow: source.flow,
        description: source.desc,
        tag: source.tag,
        tagClass: source.tagClass,
        rating: 0,
        reviewCount: 0,
        status: 'active',
      },
    })

    const variants = source.type === 'panty' && source.sizes?.length
      ? source.sizes.map((size) => ({
          sku: `${source.id}-${size}`,
          kind: 'size' as const,
          label: size,
          size,
          packCount: null,
          price: source.price,
          stock: 100,
        }))
      : source.packs?.length
        ? source.packs.map((pack) => ({
            sku: `${source.id}-${pack.count}`,
            kind: 'pack' as const,
            label: `${pack.count} pcs`,
            size: null,
            packCount: pack.count,
            price: pack.price,
            stock: 200,
          }))
        : (() => {
            const count = Number(source.meta.match(/(\d+)\s*(?:pads?|liners?)/)?.[1] ?? 1)
            return [{
              sku: `${source.id}-${count}`,
              kind: 'pack' as const,
              label: `${count} pcs`,
              size: null,
              packCount: count,
              price: source.price,
              stock: 200,
            }]
          })()

    for (const variant of variants) {
      await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        create: { productId: product.id, ...variant, active: true },
        update: { productId: product.id, ...variant, active: true },
      })
    }

    // Gallery, features and specs used to be seeded from a hardcoded EXTRAS map.
    // That map was deleted deliberately — the product page resolves all of it
    // from the database now, so a shipped fixture could only disagree with what
    // the admin console had published. The seed therefore establishes the one
    // catalog image it knows about and leaves the rest to the console.
    // Existing rows are left alone so re-seeding never wipes published content.
    if (source.img && (await prisma.productImage.count({ where: { productId: product.id } })) === 0) {
      await prisma.productImage.create({ data: { productId: product.id, url: source.img, position: 0 } })
    }
  }
  console.log(`Seeded products (${PRODUCTS.length}) with catalog details`)
}

async function seedBlogPosts() {
  for (const post of POSTS) {
    const category = await prisma.blogCategory.findUnique({ where: { name: post.category } })
    if (!category) throw new Error(`Missing blog category: ${post.category}`)
    const data = {
      title: post.title,
      categoryId: category.id,
      excerpt: post.excerpt,
      author: post.author,
      readTime: post.readTime,
      tone: post.tone,
      image: post.image,
      featured: post.featured ?? false,
      body: post.body,
      publishedAt: new Date(post.date),
    }
    await prisma.blogPost.upsert({
      where: { slug: post.slug },
      create: { slug: post.slug, ...data },
      update: data,
    })
  }
  console.log(`Seeded blog posts (${POSTS.length})`)
}

/**
 * Subscription cadences — reference data, not demo content. The product page
 * offers a fixed set of three options and posts the code to /api/subscriptions,
 * which resolves it here; without these rows every subscribe attempt is a 400.
 * Sourced from CADENCES so the picker and the database cannot drift.
 */
async function seedCadences() {
  for (const [position, cadence] of CADENCES.entries()) {
    const row = { label: cadence.label, sub: cadence.sub, days: cadence.days, active: true, position }
    await prisma.cadence.upsert({
      where: { code: cadence.id },
      create: { code: cadence.id, ...row },
      update: row,
    })
  }
  console.log(`Seeded subscription cadences (${CADENCES.length})`)
}

async function main() {
  console.log('Seeding Femi9 catalog and blog content...')
  await seedBlogCategories()
  await seedProducts()
  await seedBlogPosts()
  await seedCadences()
  console.log('Done.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

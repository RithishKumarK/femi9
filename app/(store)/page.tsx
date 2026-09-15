import type { Metadata } from 'next'
import { Home } from '@/screens/Home'
import { listFeaturedProducts, type ProductWithVariants } from '@femi9/core/services/products'
import { listPosts, type BlogPostDTO } from '@femi9/core/services/blog'

export const metadata: Metadata = {
  title: 'Femi9 Sanitary Pads | Rash-Free, Cotton-Soft Period Care India',
  description:
    'Shop Femi9 sanitary pads-cotton-soft, breathable, and reliably absorbent. Discover rash-free period care designed for everyday confidence. Made in India.',
}

// The catalog + journal teaser come from Postgres, so this page must render at
// request time (the DB isn't reachable during the container image build).
export const dynamic = 'force-dynamic'

// Server component: the catalog grid and journal teaser are now sourced from
// Postgres. We fetch on the server and hand the data to the (client) Home
// screen as props, so the markup/behaviour is unchanged — only the source moved.
export default async function HomePage() {
  // Keep the public landing page available when the catalog database is
  // temporarily unreachable (for example, in a fresh local checkout). The
  // Figma-authored teaser cards have their own visual fallbacks, while valid
  // database connections still provide live product and journal links.
  // Testimonials are no longer fetched here: the landing rail plays the customer
  // video clips (see VideoTestimonials), and the moderated Review table is read
  // by the product page, where the written reviews are shown.
  // The product rail is the FEATURED five, chosen in the console (Products →
  // the star on a row). It used to be the whole catalogue sliced to four, i.e.
  // whichever products happened to be created first — the row of cards most
  // shoppers ever see, decided by data-entry order and unchangeable without
  // re-creating a product. With nothing featured yet this still returns the
  // first five, so the page never renders an empty rail.
  const [products, posts] = await Promise.all([
    listFeaturedProducts('femi9').catch(() => []),
    listPosts('femi9').catch(() => []),
  ])
  return <Home products={products} posts={posts} />
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { listProducts } from '@femi9/core/services/products'
import { ShopCatalog } from '@/components/ShopCatalog'

/**
 * /shop — the full catalog.
 *
 * Formerly /products. The nav, the footer, the dashboard and the blog all
 * called this surface "Shop" while the route and the nav label said "Products";
 * the wording is now one word everywhere and /products 308s here so old links
 * and anything already indexed still land.
 *
 * The page itself stays a server component so the catalog is still read on the
 * server; the filter/sort rail and the grid it drives live in <ShopCatalog>,
 * which is the only client boundary.
 */

export const metadata: Metadata = {
  title: 'Shop All Sanitary Pads | Femi9 Organic Period Care',
  description:
    'Every Femi9 pad in one place - light, regular and heavy flow, plus reusable period underwear. Cotton-soft, breathable and rash-free.',
}

// Reads the live catalog, so it renders per request (the DB is not reachable
// during the container image build).
export const dynamic = 'force-dynamic'

export default async function ShopPage() {
  const products = await listProducts('femi9').catch(() => [])

  return (
    <main className="wrap section shop-page">
      <span className="eyebrow">Shop</span>
      <h1 className="display" style={{ fontSize: 'clamp(2rem,4.5vw,3rem)', margin: '.35em 0 .5rem' }}>
        Every Femi9 pad, in one place.
      </h1>
      <p style={{ color: 'var(--muted)', maxWidth: '52ch', lineHeight: 1.55, marginBottom: 'clamp(24px,3.5vw,38px)' }}>
        Light, regular or heavy - choose the size and protection that matches your flow.
      </p>

      {products.length === 0 ? (
        <div style={{ padding: 'clamp(32px,5vw,56px) 0' }}>
          <p style={{ color: 'var(--muted)', marginBottom: 18 }}>
            Our catalog is being updated right now. Please check back shortly.
          </p>
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
        </div>
      ) : (
        <ShopCatalog products={products} />
      )}
    </main>
  )
}

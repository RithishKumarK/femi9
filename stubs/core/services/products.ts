/**
 * Catalogue reads — fixture-backed.
 *
 * The real service maps `Product` / `ProductVariant` / `Review` rows out of
 * Postgres. Here the same shapes are served from the constant below, which is
 * the catalogue that `src/data/products.ts` shipped before the data moved into
 * the database. Every product carries real variant ids so the cart, the pack
 * picker and the size run all behave exactly as they do against the real thing.
 */

import type { Product, ProductExtra } from '../types/catalog'
import type { Brand } from '../../db'

export type { Product, ProductExtra }

/** A purchasable line: a pack count on a pad, or a size on the underwear. */
export interface Variant {
  id: string
  kind: 'pack' | 'size'
  label: string
  price: number
  /** Pieces in the pack. Null on a size variant. */
  packCount: number | null
  /** "M". Null on a pack variant. */
  size: string | null
  stock: number
  sku?: string | null
}

export type ProductWithVariants = Product & {
  variants: Variant[]
  featured?: boolean
}

export interface ProductReview {
  id: string
  name: string
  place: string
  title: string
  body: string
  rating: number
  date: string
  verified: boolean
  helpfulUp: number
  helpfulDown: number
}

type Pack = { count: number; price: number }

/** Pack variants for a pad, derived from its `packs` so the two cannot drift. */
function packVariants(id: string, packs: Pack[]): Variant[] {
  return packs.map((p) => ({
    id: `${id}-x${p.count}`,
    kind: 'pack' as const,
    label: `${p.count} pads`,
    price: p.price,
    packCount: p.count,
    size: null,
    stock: 120,
  }))
}

function sizeVariants(id: string, sizes: string[], price: number): Variant[] {
  return sizes.map((s) => ({
    id: `${id}-${s.toLowerCase()}`,
    kind: 'size' as const,
    label: s,
    price,
    packCount: null,
    size: s,
    stock: 40,
  }))
}

const PACKS_330 : Pack[] = [
  { count: 3, price: 79 },
  { count: 6, price: 149 },
  { count: 9, price: 225 },
]
const PACKS_290 : Pack[] = [
  { count: 3, price: 69 },
  { count: 6, price: 129 },
  { count: 9, price: 198 },
]

const CATALOG: ProductWithVariants[] = [
  {
    id: 'p330dw',
    name: 'Femi9 330mm Pads (Double Wings)',
    price: 225,
    img: '/assets/img/prod-330-double.webp',
    meta: '9 pads · 330mm',
    flow: 'Heavy · Night + Day',
    desc: 'Extra-length with double wings for overnight security.',
    tag: 'Bestseller',
    type: 'pad',
    featured: true,
    packs: PACKS_330,
    variants: packVariants('p330dw', PACKS_330),
  },
  {
    id: 'p290l9',
    name: 'Femi9 290mm Pads (Large)',
    price: 198,
    img: '/assets/img/prod-290-large9.webp',
    meta: '9 pads · 290mm',
    flow: 'Regular · Everyday',
    desc: 'The everyday large. Nine pads for a full, comfy cycle.',
    type: 'pad',
    featured: true,
    packs: PACKS_290,
    variants: packVariants('p290l9', PACKS_290),
  },
  {
    id: 'p330cw',
    name: 'Femi9 330mm Pads (Centre Wings)',
    price: 225,
    img: '/assets/img/prod-330-centre.webp',
    meta: '9 pads · 330mm',
    flow: 'Heavy · Night',
    desc: 'Extra-length with centre wings and a wider back.',
    type: 'pad',
    featured: true,
    packs: PACKS_330,
    variants: packVariants('p330cw', PACKS_330),
  },
  {
    id: 'p290l3',
    name: 'Femi9 290mm Pads (Starter)',
    price: 72,
    img: '/assets/img/prod-290-large3.webp',
    meta: '3 pads · 290mm',
    flow: 'Try it · Everyday',
    desc: 'A three-pad starter to feel the Femi9 difference.',
    tag: 'Trial pack',
    tagClass: 'pink',
    type: 'pad',
    featured: true,
    packs: [{ count: 3, price: 72 }],
    variants: packVariants('p290l3', [{ count: 3, price: 72 }]),
  },
  {
    id: 'p180m9',
    name: 'Femi9 180mm Mini Pads',
    price: 99,
    // prod-180-mini.webp was never shipped, so this points at a real pack shot.
    img: '/assets/img/prod-290-large3.webp',
    meta: '30 pads · 180mm',
    flow: 'Light Flow · Daily Freshness',
    desc:
      'Ultra-thin, breathable everyday protection for light flow, daily discharge, ' +
      'spotting, and minor urinary leakage.',
    type: 'pad',
    featured: true,
    packs: [{ count: 30, price: 99 }],
    variants: packVariants('p180m9', [{ count: 30, price: 99 }]),
  },
  {
    id: 'ppanty',
    name: 'Femi9 Period Panties',
    price: 649,
    img: '/assets/img/prod-330-centre.webp',
    meta: 'Reusable · up to 40 washes',
    flow: 'Leak-proof · Medium to Heavy',
    desc: 'Soft, breathable and reusable. A full night of protection you can wash and wear again.',
    tag: 'New',
    type: 'panty',
    sizes: ['S', 'M', 'L', 'XL'],
    variants: sizeVariants('ppanty', ['S', 'M', 'L', 'XL'], 649),
  },
]

/** Long copy, gallery and spec table, keyed by product id. */
const EXTRAS: Record<string, ProductExtra> = {}
for (const p of CATALOG) {
  EXTRAS[p.id] =
    p.type === 'panty'
      ? {
          gallery: ['lilac', 'plum', 'gold'],
          long:
            'A reusable period brief with a four-layer leak-proof gusset: a dry-touch ' +
            'top sheet, an absorbent core, a waterproof membrane and a soft cotton ' +
            'outer. Rinse cold, machine wash, line dry, good for around 40 washes.',
          rating: 4.6,
          reviews: 38,
          features: [
            { title: 'Leak-proof gusset', body: 'Four bonded layers hold up to three pads worth.' },
            { title: 'Reusable', body: 'Around 40 washes before the core softens.' },
            { title: 'Breathable', body: 'Cotton outer, no plastic against the skin.' },
          ],
          specs: [
            { k: 'Material', v: 'Cotton outer, four-layer gusset' },
            { k: 'Sizes', v: 'S / M / L / XL' },
            { k: 'Care', v: 'Cold rinse, machine wash, line dry' },
            { k: 'Life', v: 'Up to 40 washes' },
          ],
        }
      : {
          gallery: [p.img, '/assets/img/prod-290-large9.webp', '/assets/img/prod-330-double.webp'],
          long:
            `${p.desc} An organic cotton-soft top sheet, a breathable back sheet and a ` +
            'mood-lifting anion strip: toxin-free, chlorine-free and kind to skin that ' +
            'has had enough of plastic.',
          rating: 4.7,
          reviews: 126,
          features: [
            { title: 'Cotton-soft top sheet', body: 'No plastic mesh, so no rash by day three.' },
            { title: 'Anion strip', body: 'The green core that keeps odour down all day.' },
            { title: 'Toxin-free', body: 'No chlorine bleach, no fragrance, no dyes.' },
          ],
          specs: [
            { k: 'Length', v: (p.meta.split('·')[1] ?? '').trim() || '-' },
            { k: 'Pack', v: (p.meta.split('·')[0] ?? '').trim() },
            { k: 'Top sheet', v: 'Organic cotton-soft non-woven' },
            { k: 'Core', v: 'Anion strip + SAP' },
            { k: 'Made in', v: 'India' },
          ],
        }
}

const REVIEWS: ProductReview[] = [
  {
    id: 'rv1',
    name: 'Aishwarya R.',
    place: 'Chennai',
    title: 'Finally no rash',
    body:
      'I used to dread day three because of the rash. Three cycles on Femi9 and there ' +
      'has been none at all. The cotton top sheet really is different.',
    rating: 5,
    date: '2026-06-12',
    verified: true,
    helpfulUp: 24,
    helpfulDown: 1,
  },
  {
    id: 'rv2',
    name: 'Meera K.',
    place: 'Bengaluru',
    title: 'Great for nights',
    body: 'The 330 with double wings holds through a full night of sleep. No back leaks.',
    rating: 5,
    date: '2026-05-28',
    verified: true,
    helpfulUp: 17,
    helpfulDown: 0,
  },
  {
    id: 'rv3',
    name: 'Sneha P.',
    place: 'Pune',
    title: 'Comfortable, slightly pricey',
    body:
      'Very comfortable and genuinely breathable. I wish the nine-pack were a little ' +
      'cheaper, but I have stopped buying anything else.',
    rating: 4,
    date: '2026-05-02',
    verified: true,
    helpfulUp: 9,
    helpfulDown: 2,
  },
]

export async function listProducts(_brand: Brand): Promise<ProductWithVariants[]> {
  return CATALOG
}

export async function listFeaturedProducts(_brand: Brand): Promise<ProductWithVariants[]> {
  const featured = CATALOG.filter((p) => p.featured)
  // Same rule as the real service: never render an empty rail.
  return (featured.length ? featured : CATALOG).slice(0, 5)
}

export async function getProduct(
  _brand: Brand,
  id: string,
): Promise<{ product: ProductWithVariants; extra: ProductExtra; reviews: ProductReview[] } | null> {
  const product = CATALOG.find((p) => p.id === id)
  if (!product) return null
  return { product, extra: EXTRAS[product.id], reviews: REVIEWS }
}

/** Variant lookup for the in-memory cart. Not part of the real service's API. */
export function findVariant(
  variantId: string,
): { product: ProductWithVariants; variant: Variant } | null {
  for (const product of CATALOG) {
    const variant = product.variants.find((v) => v.id === variantId)
    if (variant) return { product, variant }
  }
  return null
}

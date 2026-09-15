// The catalog view-model types moved to @femi9/core (services/products.ts maps
// database rows onto them, and a package cannot import from an app). They are
// re-exported here so existing `from '@/data/products'` imports keep working.
export type { Product, ProductType, PackOption } from '@femi9/core/types/catalog'
import type { Product } from '@femi9/core/types/catalog'

export const PRODUCTS: Product[] = [
  {
    id: 'p330dw',
    name: '330mm Double Wings',
    price: 225,
    img: '/assets/img/prod-330-double.webp',
    meta: '9 pads · 330mm',
    flow: 'Heavy · Night + Day',
    desc: 'Extra-length with double wings for overnight security.',
    tag: 'Bestseller',
    type: 'pad',
    packs: [
      { count: 3, price: 79 },
      { count: 6, price: 149 },
      { count: 9, price: 225 },
    ],
  },
  {
    id: 'p290l9',
    name: '290mm Large',
    price: 198,
    img: '/assets/img/prod-290-large9.webp',
    meta: '9 pads · 290mm',
    flow: 'Regular · Everyday',
    desc: 'The everyday large. Nine pads for a full, comfy cycle.',
    type: 'pad',
    packs: [
      { count: 3, price: 69 },
      { count: 6, price: 129 },
      { count: 9, price: 198 },
    ],
  },
  {
    id: 'p330cw',
    name: '330mm Centre Wings',
    price: 225,
    img: '/assets/img/prod-330-centre.webp',
    meta: '9 pads · 330mm',
    flow: 'Heavy · Night',
    desc: 'Extra-length with centre wings and a wider back.',
    type: 'pad',
    packs: [
      { count: 3, price: 79 },
      { count: 6, price: 149 },
      { count: 9, price: 225 },
    ],
  },
  {
    id: 'p290l3',
    name: '290mm Starter',
    price: 72,
    img: '/assets/img/prod-290-large3.webp',
    meta: '3 pads · 290mm',
    flow: 'Try it · Everyday',
    desc: 'A three-pad starter to feel the Femi9 difference.',
    tag: 'Trial pack',
    tagClass: 'pink',
    type: 'pad',
  },
  {
    id: 'ppanty',
    name: 'Period Panties',
    price: 649,
    img: '/assets/img/prod-330-centre.webp',
    meta: 'Reusable · up to 40 washes',
    flow: 'Leak-proof · Medium–Heavy',
    desc: 'Soft, breathable and reusable. A full night of protection you can wash and wear again.',
    tag: 'New',
    type: 'panty',
    sizes: ['S', 'M', 'L', 'XL'],
  },
  {
    id: 'p180m9',
    name: 'Femi9 180mm Mini Pads',
    price: 99,
    // prod-180-mini.webp was never shipped — the file is absent from public/assets/img,
    // so this card rendered a broken-image glyph at every viewport. Point at a real pack
    // shot until the 180mm photography lands.
    img: '/assets/img/prod-290-large3.webp',
    meta: '30 pads · 180mm',
    flow: 'Light Flow · Daily Freshness',
    desc: 'Ultra-thin, breathable everyday protection for light flow, daily discharge, spotting, and minor urinary leakage.',
    type: 'pad',
    packs: [
      { count: 30, price: 99 }
    ],
  },
]

/** Subscribe & save — applied on every product page. */
export const SUBSCRIBE_PCT = 15
export interface Cadence {
  id: string
  label: string
  sub: string
  /** approximate days until first delivery, for the "next delivery" hint */
  days: number
}
export const CADENCES: Cadence[] = [
  { id: 'cycle', label: 'Every cycle', sub: 'Arrives ~3 days before your period', days: 25 },
  { id: '4w', label: 'Every 4 weeks', sub: 'A steady four-week refill', days: 28 },
  { id: '6w', label: 'Every 6 weeks', sub: 'For lighter or shorter cycles', days: 42 },
]

export const FREE_SHIP = 999
export const WA_NUMBER = '919042916499'

export const rupees = (n: number): string => 'Rs.' + n.toLocaleString('en-IN')

/** discounted subscription price, rounded to the rupee */
export const subPrice = (price: number): number => Math.round((price * (100 - SUBSCRIBE_PCT)) / 100)

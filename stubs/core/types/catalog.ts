/**
 * The catalogue view-model — the shape every product surface renders.
 *
 * In the real package these types sit beside `services/products.ts`, which maps
 * Prisma rows onto them. Here they are reproduced from the shapes the app's own
 * components read, so the components are the specification.
 */

export type ProductType = 'pad' | 'panty' | 'diaper'

/** One pack size on a pad: "3 pads for Rs.79". */
export interface PackOption {
  count: number
  price: number
}

export interface Product {
  id: string
  name: string
  price: number
  img: string
  meta: string
  flow: string
  desc: string
  tag?: string
  tagClass?: string
  type: ProductType
  packs?: PackOption[]
  sizes?: string[]
}

/** Everything the product page shows that the card does not. */
export interface ProductExtra {
  /** Gallery image URLs. For a panty these are PantyArt variant names. */
  gallery: string[]
  /** Long-form description under "Product details". */
  long: string
  /** Catalogue rating, used until moderated reviews exist. */
  rating: number
  /** Catalogue review count, same fallback role as `rating`. */
  reviews: number
  features: { title: string; body: string }[]
  specs: { k: string; v: string }[]
}

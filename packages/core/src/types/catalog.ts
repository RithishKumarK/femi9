/**
 * Catalog view-model types.
 *
 * These describe the shape the storefront UI expects, NOT the database rows.
 * `services/products.ts` maps Prisma rows onto them, which is why they live
 * beside the service rather than beside the app's static catalog data — a
 * package cannot reach back into an app for its types.
 *
 * `apps/femi9-web/src/data/products.ts` re-exports them, so existing component
 * imports keep working unchanged.
 */

export type ProductType = 'pad' | 'panty'

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
  tagClass?: 'pink'
  /** 'pad' (default) sells by pack count; 'panty' sells by body size. */
  type?: ProductType
  /** Pads: available pack sizes (3 / 6 / 9 pcs). Default price matches the last pack. */
  packs?: PackOption[]
  /** Panties: available body sizes. */
  sizes?: string[]
}

export interface ProductExtra {
  gallery: string[]
  rating: number
  reviews: number
  long: string
  features: { title: string; body: string }[]
  specs: { k: string; v: string }[]
}

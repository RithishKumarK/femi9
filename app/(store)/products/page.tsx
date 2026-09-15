import { permanentRedirect } from 'next/navigation'

/**
 * /products → /shop.
 *
 * The catalog moved when the nav label did: every surface on the site already
 * called it "Shop", so the route now matches the word. This stub stays because
 * the old path is out in the world — in anything already indexed, in shared
 * links, and in the QR/print material — and deleting it would turn all of that
 * into a 404. A 308 keeps the link equity and tells crawlers where it went.
 */
export default function ProductsRedirect(): never {
  permanentRedirect('/shop')
}

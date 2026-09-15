import type { ProductWithVariants } from '@femi9/core/services/products'

/**
 * The size run — the row of size chips at the top of the product page.
 *
 * Lumi9 has one product with five sizes, so its size picker is a route
 * parameter: `/product/m`. Femi9's catalogue is shaped the other way round —
 * each pad LENGTH is its own product row, with pack counts underneath — so the
 * equivalent picker is a row of links to sibling products. The URL still
 * changes with the choice, which is the property that actually matters: a size
 * a shopper picked is a size she can send to someone else.
 *
 * Nothing here is hardcoded. Products are administered from /admin, and a list
 * of lengths written into the source would silently stop matching the catalogue
 * the first time someone adds a 240mm. Every chip below came out of a product
 * that is on the site right now.
 */

export interface SizeOption {
  /** Product slug — the chip links to `/product/{slug}`. */
  slug: string
  /** "290mm", or the product name when no length can be read off it. */
  label: string
  /** The disambiguator under the label: "Large", "Double Wings", "Mini". */
  sub: string
  /** Sort key. Products with no readable length sort last. */
  mm: number
}

/**
 * Pad length in mm.
 *
 * Read from the copy AFTER the middot on the meta line ("9 pads · 330mm"), then
 * from the name as a fallback ("Femi9 180mm Mini Pads"). The pack count sits
 * BEFORE the middot, so reading the whole line would make a 12-pack a 12mm pad;
 * and the range guard keeps a panty's "up to 40 washes" from contributing a
 * 40mm size.
 */
export function padLength(product: Pick<ProductWithVariants, 'meta' | 'name'>): number {
  const tail = (product.meta ?? '').split('·').slice(1).join(' ')
  const fromMeta = (tail.match(/\d{2,4}/g) ?? []).map(Number).filter((n) => n >= 100 && n <= 500)
  if (fromMeta.length) return Math.min(...fromMeta)

  const fromName = (product.name ?? '').match(/(\d{3,4})\s*mm/i)?.[1]
  const parsed = fromName ? Number(fromName) : 0
  return parsed >= 100 && parsed <= 500 ? parsed : 0
}

/**
 * What distinguishes this product from the other one at the same length.
 *
 * Two 330mm pads differ only by their wings, so the length alone cannot label
 * the chip. A parenthesised qualifier wins when there is one — the live
 * catalogue names read "Femi9 Anion 280mm Pads (Large)" — otherwise it is
 * whatever survives stripping the brand, the length and the word "pads".
 */
export function sizeQualifier(name: string): string {
  const parenthesised = name.match(/\(([^)]+)\)/)?.[1]?.trim()
  if (parenthesised) return parenthesised

  const stripped = name
    .replace(/femi9/gi, '')
    .replace(/\d{2,4}\s*mm/gi, '')
    .replace(/\bpads?\b/gi, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return stripped || name
}

/**
 * Every pad in the catalogue as a size chip, shortest first, INCLUDING the one
 * being viewed — the current size has to be in the row or the row cannot show
 * which one is selected.
 *
 * Period underwear is excluded: it carries real S/M/L/XL variants on the single
 * product and picks its size on the page, not by navigating. Returns an empty
 * array when there is only one pad, since a picker with one option is furniture.
 */
export function sizeRun(products: ProductWithVariants[]): SizeOption[] {
  const pads = products.filter((p) => p.type !== 'panty')
  if (pads.length < 2) return []

  return pads
    .map((p) => {
      const mm = padLength(p)
      return {
        slug: p.id,
        label: mm ? `${mm}mm` : p.name,
        sub: sizeQualifier(p.name),
        mm,
      }
    })
    .sort((a, b) => {
      // Unreadable lengths sort to the end rather than to the front, where a 0
      // would put them.
      if (a.mm !== b.mm) return (a.mm || Infinity) - (b.mm || Infinity)
      return a.sub.localeCompare(b.sub)
    })
}

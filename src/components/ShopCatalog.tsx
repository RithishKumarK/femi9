'use client'

/**
 * /shop — the filter + sort rail and the grid it drives.
 *
 * The catalog page is a server component so the product read stays on the
 * server; everything that reacts to a click lives here, behind one client
 * boundary, and receives the already-resolved (zone-priced) product list.
 *
 * Facets are DERIVED from the catalog, never hardcoded. The products are
 * administered from /admin — a hardcoded "Heavy / Regular / Light" list would
 * silently stop matching the day someone adds a flow we did not predict, and a
 * filter that hides stock is worse than no filter. Every option shown here came
 * out of a product currently on the page, so it can never filter to nothing.
 *
 * The rail is deliberately SHORT: four facets, rendered as wrapping pills
 * rather than a column of checkbox rows. That is not only a density
 * preference — a rail taller than the viewport needs its own scrollbar, and a
 * nested scroller inside Lenis has its wheel events swallowed unless it is
 * tagged `data-lenis-prevent` (see the /admin note in SmoothScroll.tsx). Keeping
 * it inside one screen removes the second scroller, and with it the conflict.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ProductWithVariants } from '@femi9/core/services/products'
import { rupees } from '../data/products'
import { ProductCard } from './ProductCard'

type GroupKey = 'type' | 'flow' | 'length' | 'pack'

type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'name-asc' | 'pack-desc'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'pack-desc', label: 'Most pads per pack' },
  { value: 'name-asc', label: 'Name: A to Z' },
]

/**
 * The four questions worth asking, in the order she'd ask them.
 *
 * Deliberately NOT here: "Best for" (day / night / overnight), which only ever
 * restates what Flow already encodes — the products read "Heavy · Night + Day",
 * so the two groups moved together and the second one earned no clicks; and
 * "Highlights" (Bestseller / Combo / Trial), which is already printed on the
 * card itself as a badge she can see without opening a filter.
 */
const GROUP_KEYS: GroupKey[] = ['type', 'flow', 'length', 'pack']

const GROUP_LABELS: Record<GroupKey, string> = {
  type: 'Category',
  flow: 'Flow',
  length: 'Pad length',
  pack: 'Pack size',
}

/** Facet values pulled off one product, keyed by the group that renders them. */
interface Facets {
  type: string[]
  flow: string[]
  length: string[]
  pack: string[]
  price: number
  packCount: number
}

/** "Regular · Night + Day" → "Regular". The copy before the middot is the flow. */
function flowOf(product: ProductWithVariants): string[] {
  const head = (product.flow ?? '').split('·')[0]?.trim()
  if (!head) return []
  // "Try it" marks a trial pack, not an absorbency — listing it beside
  // Light/Regular/Heavy would read as a fourth flow weight.
  if (/^try/i.test(head)) return []
  return [head.replace(/\s*flow$/i, '')]
}

/**
 * Pad length in mm, off the meta line ("12 pads · 280mm", or the combo pack's
 * "6 pads · 280 / 320 / 180mm" — three lengths inside one product).
 *
 * Only the copy after the middot is read, and only numbers in a plausible pad
 * range: the pack count sits BEFORE the middot, and a panty's
 * "Reusable · up to 40 washes" would otherwise contribute a "40mm" option.
 */
function lengthsOf(product: ProductWithVariants): string[] {
  if (product.type === 'panty') return []
  const tail = (product.meta ?? '').split('·').slice(1).join(' ')
  const found = (tail.match(/\d{2,4}/g) ?? [])
    .map(Number)
    .filter((n) => n >= 100 && n <= 500)
  return Array.from(new Set(found)).map(String)
}

/** How many pieces are in the pack — from the variants, else off the meta line. */
function packCountOf(product: ProductWithVariants): number {
  const fromVariant = (product.variants ?? [])
    .filter((v) => v.kind === 'pack' && v.packCount)
    .map((v) => v.packCount as number)
  if (fromVariant.length) return Math.max(...fromVariant)
  const fromMeta = (product.meta ?? '').split('·')[0]?.match(/(\d+)/)?.[1]
  return fromMeta ? Number(fromMeta) : 0
}

function facetsOf(product: ProductWithVariants): Facets {
  const packCount = packCountOf(product)
  return {
    // Short by design: these render as pills in a 236px rail, and "Period
    // underwear" alone was wide enough to take a row to itself.
    type: [product.type === 'panty' ? 'Underwear' : 'Pads'],
    flow: flowOf(product),
    length: lengthsOf(product),
    pack: packCount ? [String(packCount)] : [],
    price: product.price,
    packCount,
  }
}

/** Pack sizes and lengths are numbers wearing string clothes — sort as numbers. */
function compareOption(key: GroupKey, a: string, b: string) {
  if (key === 'length' || key === 'pack') return Number(a) - Number(b)
  return a.localeCompare(b)
}

function optionLabel(key: GroupKey, value: string) {
  if (key === 'length') return `${value}mm`
  if (key === 'pack') return `${value} pcs`
  return value
}

type Selection = Record<GroupKey, string[]>

const EMPTY: Selection = { type: [], flow: [], length: [], pack: [] }

const Cross = () => (
  <svg viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1 1l8 8M9 1L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export function ShopCatalog({ products }: { products: ProductWithVariants[] }) {
  const [selected, setSelected] = useState<Selection>(EMPTY)
  const [sort, setSort] = useState<SortKey>('featured')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Parse each product once per catalog, not once per click on a pill: reading
  // six meta strings is cheap, but the array identity has to stay stable or
  // every memo below recomputes on every interaction.
  const rows = useMemo(
    () => products.map((product) => ({ product, facets: facetsOf(product) })),
    [products]
  )

  const prices = rows.map((r) => r.facets.price)
  const floorPrice = prices.length ? Math.floor(Math.min(...prices)) : 0
  const ceilPrice = prices.length ? Math.ceil(Math.max(...prices)) : 0
  const hasPriceRange = ceilPrice > floorPrice

  const [maxPrice, setMaxPrice] = useState(ceilPrice)
  // The catalog can change under us (a new product, a zone that prices
  // differently). Re-seat the ceiling rather than leaving the slider pinned
  // below the dearest product, which would hide it with no visible cause.
  useEffect(() => setMaxPrice(ceilPrice), [ceilPrice])

  /** Only the groups that can actually tell two products apart. */
  const groups = useMemo(
    () =>
      GROUP_KEYS.map((key) => {
        const values = new Set<string>()
        rows.forEach((r) => r.facets[key].forEach((v) => values.add(v)))
        const options = Array.from(values).sort((a, b) => compareOption(key, a, b))
        return { key, label: GROUP_LABELS[key], options }
      })
        // A group every product answers identically ("Category: Sanitary pads",
        // when pads are all we sell) is a control that can only ever be a no-op.
        .filter((g) => g.options.length > 1),
    [rows]
  )

  /**
   * Does this row survive every group EXCEPT `skip`? Used for the visible set
   * (skip = null) and, with a group skipped, to grey out that group's dead ends.
   */
  const passes = (row: { facets: Facets }, skip: GroupKey | null) => {
    for (const g of groups) {
      if (g.key === skip) continue
      const chosen = selected[g.key]
      // Within one group the picked options are an OR; across groups, an AND.
      if (chosen.length && !chosen.some((v) => row.facets[g.key].includes(v))) return false
    }
    if (hasPriceRange && row.facets.price > maxPrice) return false
    return true
  }

  const visible = useMemo(() => {
    const kept = rows.filter((row) => passes(row, null))
    if (sort === 'price-asc') kept.sort((a, b) => a.facets.price - b.facets.price)
    if (sort === 'price-desc') kept.sort((a, b) => b.facets.price - a.facets.price)
    if (sort === 'pack-desc') kept.sort((a, b) => b.facets.packCount - a.facets.packCount)
    if (sort === 'name-asc') kept.sort((a, b) => a.product.name.localeCompare(b.product.name))
    return kept
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groups, selected, sort, maxPrice, hasPriceRange])

  /**
   * How many products this pill would leave, counted against the OTHER groups
   * only. Picking "Heavy" must not grey out every other flow beside it — within
   * a group they are alternatives, not additional conditions.
   */
  const countFor = (key: GroupKey, value: string) =>
    rows.filter((row) => row.facets[key].includes(value) && passes(row, key)).length

  const toggle = (key: GroupKey, value: string) =>
    setSelected((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))

  const activeChips = groups.flatMap((g) =>
    selected[g.key].map((value) => ({ key: g.key, value, label: optionLabel(g.key, value) }))
  )
  const priceNarrowed = hasPriceRange && maxPrice < ceilPrice
  const filterCount = activeChips.length + (priceNarrowed ? 1 : 0)
  // A range input tells CSS nothing about where its thumb sits, so the filled
  // half of the track is painted from this, handed down as a custom property.
  const fillPct = hasPriceRange
    ? Math.round(((maxPrice - floorPrice) / (ceilPrice - floorPrice)) * 100)
    : 100

  const clearAll = () => {
    setSelected(EMPTY)
    setMaxPrice(ceilPrice)
  }

  // On a phone the rail is a sheet over the page. Freeze the page behind it, or
  // the scroll inside the sheet chains to the grid underneath and she loses her
  // place in the catalog the moment she closes it.
  useEffect(() => {
    if (!drawerOpen) return
    const prior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prior
      document.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  return (
    <div className="shop-layout">
      {/* Phone/tablet-only opener. The rail markup below is shared: CSS decides
          whether it sits in the column or slides in as a sheet. */}
      <div className="shop-bar">
        <button
          type="button"
          className="shop-bar__btn"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="shop-rail"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 3.5h13M3.5 8h9M6 12.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Filter &amp; sort
          {filterCount > 0 && <span className="shop-bar__badge">{filterCount}</span>}
        </button>
        {/* The verbose "Showing 6 of 6 products" line is hidden at this width, so
            this is the only running count on a phone. */}
        <span className="shop-bar__count" aria-live="polite">
          {visible.length} of {rows.length}
        </span>
      </div>

      <aside
        id="shop-rail"
        className={`shop-rail${drawerOpen ? ' is-open' : ''}`}
        aria-label="Filter and sort products"
      >
        {/* data-lenis-prevent: on the narrow breakpoint this becomes a scrolling
            sheet, and Lenis would otherwise swallow the wheel on its way to the
            root scroller — the same fault documented for /admin in
            SmoothScroll.tsx. Inert on desktop, where nothing here scrolls. */}
        <div className="shop-rail__inner" data-lenis-prevent>
          <button
            type="button"
            className="shop-rail__close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close filters"
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <div className="shop-rail__head">
            <h2 className="shop-rail__title">Refine</h2>
            <button
              type="button"
              className="shop-rail__clear"
              onClick={clearAll}
              disabled={filterCount === 0}
            >
              Clear all
            </button>
          </div>

          <div className="shop-facet">
            <label className="shop-facet__label" htmlFor="shop-sort-select">
              Sort by
            </label>
            <div className="shop-sort__field">
              <select
                id="shop-sort-select"
                className="shop-sort__select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <span className="shop-sort__chev">
                <svg viewBox="0 0 12 8" aria-hidden="true">
                  <path
                    d="M1 1.5 6 6.5l5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
          </div>

          {groups.map((g) => (
            <div className="shop-facet" key={g.key} role="group" aria-labelledby={`shop-facet-${g.key}`}>
              <span className="shop-facet__label" id={`shop-facet-${g.key}`}>
                {g.label}
              </span>
              <div className="shop-facet__row">
                {g.options.map((value) => {
                  const on = selected[g.key].includes(value)
                  // Dead ends grey out, but never a pill that is already on —
                  // that would take away the control she needs to undo it.
                  const dead = !on && countFor(g.key, value) === 0
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`shop-pill${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      disabled={dead}
                      onClick={() => toggle(g.key, value)}
                    >
                      {optionLabel(g.key, value)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {hasPriceRange && (
            <div className="shop-facet shop-facet--last">
              <span className="shop-facet__label">Price</span>
              <div className="shop-price">
                <div className="shop-price__read">
                  <span>Up to</span>
                  <b>{rupees(maxPrice)}</b>
                </div>
                <input
                  type="range"
                  className="shop-price__range"
                  min={floorPrice}
                  max={ceilPrice}
                  step={1}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  aria-label={`Maximum price, up to ${rupees(maxPrice)}`}
                  style={{ '--fill': `${fillPct}%` } as CSSProperties}
                />
                <div className="shop-price__ends">
                  <span>{rupees(floorPrice)}</span>
                  <span>{rupees(ceilPrice)}</span>
                </div>
              </div>
            </div>
          )}

          <button type="button" className="shop-rail__apply" onClick={() => setDrawerOpen(false)}>
            Show {visible.length} {visible.length === 1 ? 'product' : 'products'}
          </button>
        </div>
      </aside>

      {drawerOpen && (
        <div className="shop-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}

      <div className="shop-results">
        <div className="shop-results__head">
          <p className="shop-results__count" aria-live="polite">
            Showing <b>{visible.length}</b> of {rows.length} products
          </p>
          {filterCount > 0 && (
            <div className="shop-chips">
              {activeChips.map((chip) => (
                <button
                  key={`${chip.key}:${chip.value}`}
                  type="button"
                  className="shop-chip"
                  onClick={() => toggle(chip.key, chip.value)}
                >
                  {chip.label}
                  <Cross />
                  <span className="sr-only">Remove filter</span>
                </button>
              ))}
              {priceNarrowed && (
                <button type="button" className="shop-chip" onClick={() => setMaxPrice(ceilPrice)}>
                  Under {rupees(maxPrice)}
                  <Cross />
                  <span className="sr-only">Remove price filter</span>
                </button>
              )}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="shop-empty">
            <p>No products match those filters.</p>
            <button type="button" className="btn btn-ghost" onClick={clearAll}>
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="grid-products">
            {visible.map(({ product }) => (
              <ProductCard key={product.id} product={product} showInsideOnHover quickAddOnHover />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

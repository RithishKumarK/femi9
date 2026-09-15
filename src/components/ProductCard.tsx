'use client'

// Explicitly a client component: it calls useCart() for the one-tap add. It used
// to inherit the boundary from Home.tsx, its only importer, which meant the
// first server component to render a product grid (/shop) would have tried
// to run a hook on the server.

import { memo, useEffect, useState } from 'react'
import { Link } from '@/lib/router-compat'
import type { Product } from '../data/products'
import { rupees } from '../data/products'
import type { Variant } from '@femi9/core/services/products'
import { useCart } from '../store/cart'
import { PantyArt } from './PantyArt'
import { OptImg } from '@/components/OptImg'
import { useAddPulse } from '@/lib/use-add-pulse'

interface Props {
  // Cards from the catalog grid carry variants; the "related" strip on the PDP
  // reuses static products that have none — hence the optional field + guard.
  product: Product & { variants?: Variant[] }
  showInsideOnHover?: boolean
  /**
   * Catalog grid only: hide the permanent foot button and reveal "Add to cart"
   * over the photo on hover instead. Off by default so the home page keeps the
   * always-visible Buy Now it has always had.
   */
  quickAddOnHover?: boolean
}

/** Rendered if the product photo 404s, so the card shows a pack instead of the
 *  browser's broken-image glyph. There is at least one dead `img` path live. */
const IMAGE_FALLBACK = '/assets/opt/img/sample-640.webp'

export const ProductCard = memo(function ProductCard({
  product,
  showInsideOnHover = false,
  quickAddOnHover = false,
}: Props) {
  const { add } = useCart()
  const [pulsing, pulse] = useAddPulse()
  const { id, name, price, img, meta, flow, desc, tag, tagClass, type, variants } = product

  // The second "inside the pack" photo is revealed by :hover / :focus-within
  // only. A phone has neither — tapping the media link navigates to the PDP in
  // the same gesture — so it was a second full-size download that could never
  // be painted. Start false so the server never emits it, and only opt in once
  // we know the pointer can actually hover.
  const [canHover, setCanHover] = useState(false)
  useEffect(() => {
    setCanHover(window.matchMedia('(hover: hover) and (pointer: fine)').matches)
  }, [])
  const showInside = showInsideOnHover && canHover

  // Pick the default purchasable variant for a one-tap add.
  const isPanty = type === 'panty'
  const packVariants = (variants ?? []).filter((v) => v.kind === 'pack')
  const defaultVariant: Variant | undefined = isPanty
    ? (variants ?? []).find((v) => v.kind === 'size')
    : packVariants.find((v) => v.price === price) ?? packVariants[packVariants.length - 1]

  /** Add, then pulse the control that was pressed. Shared by the foot button
   *  and the hover overlay so both confirm the same way. */
  const addToBag = () => {
    if (!defaultVariant) return
    add(defaultVariant.id)
    pulse()
  }

  return (
    <article className="card">
      {/* The media link and the hover CTA are SIBLINGS inside this wrapper, not
          nested. A <button> inside an <a> is invalid HTML, and the browser would
          have to guess which of the two a click meant — so the wrapper owns the
          positioning context and the link keeps the whole photo to itself. */}
      <div className="card-media-wrap">
        <Link to={`/product/${id}`} className="card-media" aria-label={name}>
          {tag && <span className={`tag${tagClass ? ` ${tagClass}` : ''}`}>{tag}</span>}
          {type === 'panty' ? (
            <PantyArt />
          ) : (
            <>
              <img
                className={showInside ? 'card-media__image card-media__image--pack' : undefined}
                src={img}
                alt={`Femi9 ${name} pack`}
                width={720}
                height={960}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  if (e.currentTarget.src.endsWith(IMAGE_FALLBACK)) return
                  e.currentTarget.src = IMAGE_FALLBACK
                }}
              />
              {showInside && (
                <OptImg
                  className="card-media__image card-media__image--inside"
                  base="figma-home/products-imgFrame206-hover"
                  sizes="(max-width: 1180px) 46vw, 300px"
                  alt=""
                />
              )}
            </>
          )}
        </Link>

        {/* Reveal-on-hover add to cart — catalog grid only.
            Which of this and the foot button is visible is decided entirely in
            CSS by `@media (hover: hover)`, NOT by the `canHover` state above.
            That matters: `canHover` is false until the mount effect runs, so
            gating here would paint the foot button, then swap it for this one a
            frame later — a visible flash and a card-height jump on every card in
            the grid. The media query is right from the first paint.
            It stays in the DOM rather than display:none when hidden so
            :focus-within can reveal it for keyboard users; on touch the media
            query does display:none it, so it is not a phantom tap target. */}
        {quickAddOnHover && defaultVariant && (
          <button
            type="button"
            className={`card-quick-add${pulsing ? ' is-added' : ''}`}
            onClick={addToBag}
            aria-label={`Add ${name} to bag`}
          >
            Add to cart
          </button>
        )}
      </div>
      <div className="card-body">
        <span className="card-flow">{flow}</span>
        <Link to={`/product/${id}`} style={{ color: 'inherit' }}><h3>{name}</h3></Link>
        <p className="card-desc">{desc}</p>
        {/* `--quick` tells the stylesheet this card has a hover overlay, so the
            Buy Now below is hidden on hover-capable pointers and kept on touch —
            where :hover never fires and dropping it would leave the grid with no
            way to add to the bag at all. */}
        <div className={`card-foot${quickAddOnHover ? ' card-foot--quick' : ''}`}>
          <span className="price">
            <b>{rupees(price)}</b>
            <span>{meta}</span>
          </span>
          <button
            className={`add${pulsing ? ' is-added' : ''}`}
            onClick={addToBag}
            disabled={!defaultVariant}
            aria-label={`Add ${name} to bag`}
          >
            Buy Now
          </button>
        </div>
      </div>
    </article>
  )
})

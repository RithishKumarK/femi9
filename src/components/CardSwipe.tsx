'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import './CardSwipe.css'

export interface CardItem {
  id: string | number
  title: string
  subtitle?: string
  desc: string
  category?: string
  price?: number | string
  img?: string
  icon?: React.ReactNode
  tag?: string
  flow?: string
  meta?: string
  badge?: string
}

export const defaultCards: CardItem[] = [
  {
    id: 'femi9-day-pads',
    title: 'Anion Day Pads',
    subtitle: 'Regular Flow Protection',
    desc: 'Ultra-thin organic cotton pads with active anion chip technology for 8-hour freshness & quick absorption.',
    category: 'Day Care',
    flow: 'Regular Flow',
    price: '₹249',
    meta: '10 Pads / Pack',
    badge: 'Bestseller',
    img: '/assets/opt/img/sample-640.webp',
  },
  {
    id: 'femi9-night-pads',
    title: 'Anion Night Pads',
    subtitle: 'Heavy Flow & Overnight Protection',
    desc: 'Extended rear coverage and double leak-guards for total peace of mind while you sleep soundly.',
    category: 'Night Care',
    flow: 'Heavy Flow',
    price: '₹299',
    meta: '8 Extra Long Pads',
    badge: 'Popular',
    img: '/assets/opt/img/sample-640.webp',
  },
  {
    id: 'femi9-overnight-panty',
    title: '360° Period Panties',
    subtitle: 'Maximum Heavy Flow Care',
    desc: '360-degree leakproof underwear fit made with breathable organic cotton layers for overnight comfort.',
    category: 'Overnight',
    flow: 'Super Heavy Flow',
    price: '₹399',
    meta: '5 Panties / Pack',
    badge: 'New',
    img: '/assets/opt/img/sample-640.webp',
  },
  {
    id: 'femi9-panty-liners',
    title: 'Ultra-Soft Panty Liners',
    subtitle: 'Daily Spotting & Freshness',
    desc: 'Featherlight breathable liners for daily freshness, post-period discharge, and light backup care.',
    category: 'Daily Care',
    flow: 'Light Flow',
    price: '₹179',
    meta: '20 Liners / Pack',
    badge: 'Daily Essential',
    img: '/assets/opt/img/sample-640.webp',
  },
  {
    id: 'femi9-trial-pack',
    title: 'Trial Discovery Combo',
    subtitle: 'All-Flow Starter Kit',
    desc: 'Complete mix of Day, Night, and Liners in one convenient pack to discover your perfect period combo.',
    category: 'Starter Kit',
    flow: 'Multi-Flow',
    price: '₹199',
    meta: 'Mixed Pack (6 items)',
    badge: 'Trial Pack',
    img: '/assets/opt/img/sample-640.webp',
  },
]

interface CarouselCardProps {
  card: CardItem
  isActive?: boolean
  index: number
  onBuyNow?: (card: CardItem) => void
}

export function CarouselCard({ card, isActive = false, onBuyNow }: CarouselCardProps) {
  const { title, subtitle, desc, category, flow, price, meta, badge, img, icon } = card

  return (
    <article
      className={`f9-carousel-card ${isActive ? 'f9-carousel-card--active' : ''}`}
      style={{
        background: 'var(--card-bg, #FFFFFF)',
        border: '1px solid var(--card-border, rgba(60, 42, 94, 0.12))',
        borderRadius: '20px',
        boxShadow: isActive
          ? '0 16px 36px rgba(60, 42, 94, 0.14), 0 4px 12px rgba(0, 0, 0, 0.04)'
          : '0 4px 20px rgba(60, 42, 94, 0.06)',
        transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s ease, border-color 0.3s ease',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Product image. Where it sits - on top on phones, to the right of the
          details from 641px - is decided in CardSwipe.css, per breakpoint. The
          badges live with the details, so nothing covers the product. */}
      <div
        className="f9-carousel-card__media"
        style={{
          borderRadius: '14px',
          background: 'linear-gradient(135deg, rgba(245, 240, 252, 0.8) 0%, rgba(235, 226, 250, 0.9) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {icon ? (
          <div style={{ transform: 'scale(1.25)' }}>{icon}</div>
        ) : img ? (
          <img
            src={img}
            alt={`Femi9 ${title}`}
            style={{
              maxHeight: '94%',
              maxWidth: '94%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 8px 16px rgba(60, 42, 94, 0.12))',
              transition: 'transform 0.4s ease',
            }}
            loading="lazy"
            decoding="async"
          />
        ) : null}
      </div>

      {/* Details: badges, name, protection, description, then price and action. */}
      <div className="f9-carousel-card__body">
        {(badge || flow) && (
          <div className="f9-carousel-card__tags">
            {badge && (
              <span
                style={{
                  background: '#3C2A5E',
                  color: '#FFFFFF',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  boxShadow: '0 2px 8px rgba(60, 42, 94, 0.25)',
                }}
              >
                {badge}
              </span>
            )}

            {flow && (
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.92)',
                  color: '#3C2A5E',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '999px',
                  border: '1px solid rgba(60, 42, 94, 0.15)',
                }}
              >
                {flow}
              </span>
            )}
          </div>
        )}

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {category && (
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#927BB0',
              }}
            >
              {category}
            </span>
          )}

          <h3
            style={{
              margin: 0,
              fontSize: '1.2rem',
              fontWeight: 700,
              color: 'var(--card-heading, #2C1B4D)',
              lineHeight: 1.25,
            }}
          >
            {title}
          </h3>

          {subtitle && (
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                fontWeight: 500,
                color: 'var(--card-subtitle, #6B558C)',
              }}
            >
              {subtitle}
            </p>
          )}

          <p
            style={{
              margin: '4px 0 12px 0',
              fontSize: '0.86rem',
              lineHeight: 1.45,
              color: 'var(--card-desc, #554868)',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {desc}
          </p>
        </div>

        {/* Footer Area: Price & Action */}
        <div
          style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid var(--card-divider, rgba(60, 42, 94, 0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--card-price, #3C2A5E)' }}>
              {price}
            </div>
            {meta && <div style={{ fontSize: '0.75rem', color: '#82719E' }}>{meta}</div>}
          </div>

          <button
            type="button"
            onClick={() => onBuyNow?.(card)}
            style={{
              background: 'linear-gradient(135deg, #3C2A5E 0%, #563E82 100%)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '12px',
              padding: '10px 18px',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(60, 42, 94, 0.2)',
              transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'
              e.currentTarget.style.boxShadow = '0 6px 18px rgba(60, 42, 94, 0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(1)'
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(60, 42, 94, 0.2)'
            }}
          >
            Buy Now
          </button>
        </div>
      </div>
    </article>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Cover-flow motion

   One number drives every card: `position`, a continuous index (1.35 is a third
   of the way from card 1 to card 2). Each card's pose - x, y, rotation, scale,
   opacity, z-index - is interpolated from its offset to that number, so a drag,
   a spring and an arrow press are all the same motion.

   `position` is a motion value, not React state. Drags and springs write the
   card transforms straight to the DOM once per animation frame; React only
   re-renders when the ACTIVE index changes (dots, arrows, aria, card shadow).
   For a handful of cards the spring below is all the physics this needs, so
   there is no animation library.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Pose by distance from the active card: 0 = active, 1 = direct neighbour,
 * 2 = the card behind it, 3+ = parked out of sight. `x` is a fraction of the
 * card's own width, so no measuring is needed to lay the cards out.
 *
 * Side cards recede through `veil` - a white wash over the card - rather than
 * opacity. A translucent card would let the card stacked behind it show through
 * its body; washing toward the white page reads the same without the ghosting.
 * Real opacity is only used to park cards beyond the second neighbour.
 */
const POSE = {
  x: [0, 0.64, 1.18, 1.62],
  y: [0, 14, 26, 34],
  rotate: [0, 4, 6.5, 8],
  scale: [1, 0.94, 0.86, 0.8],
  veil: [0, 0.1, 0.42, 0.6],
  opacity: [1, 1, 1, 0],
}

/** Damping ratio ~0.97: a calm settle in about 0.6s with no visible overshoot. */
const SPRING = { stiffness: 240, damping: 30 }

/** Pointer travel before a press becomes a drag (below it, clicks still click). */
const DRAG_START_PX = 6

/** A release carries on for this long at its current speed before snapping. */
const THROW_PROJECTION_S = 0.18

/** A flick at least this fast always moves one card, however short it was. */
const FLICK_PX_PER_MS = 0.35

function interpolate(keys: number[], distance: number) {
  if (distance >= keys.length - 1) return keys[keys.length - 1]
  const i = Math.floor(distance)
  return keys[i] + (keys[i + 1] - keys[i]) * (distance - i)
}

function poseFor(offset: number, reduceMotion: boolean) {
  const distance = Math.abs(offset)
  const side = Math.sign(offset)
  const x = side * interpolate(POSE.x, distance) * 100
  const y = interpolate(POSE.y, distance)
  const rotate = reduceMotion ? 0 : side * interpolate(POSE.rotate, distance)
  const scale = interpolate(POSE.scale, distance)
  return {
    transform: `translate3d(${x.toFixed(3)}%, ${y.toFixed(2)}px, 0) rotate(${rotate.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
    opacity: +interpolate(POSE.opacity, distance).toFixed(4),
    zIndex: 100 - Math.round(distance * 10),
    // Hidden only once fully faded, so a parked card never pops out mid-fade.
    visibility: (distance > 2.98 ? 'hidden' : 'visible') as 'hidden' | 'visible',
    '--cf-veil': interpolate(POSE.veil, distance).toFixed(4),
  }
}

/** Past either end the carousel gives a little, and less the further it goes. */
function rubberBand(position: number, max: number) {
  const give = (over: number) => 0.35 * (1 - 1 / (over + 1))
  if (position < 0) return -give(-position)
  if (position > max) return max + give(position - max)
  return position
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  startPosition: number
  step: number
  dragging: boolean
  samples: { t: number; x: number }[]
}

export interface CardSwipeProps {
  cards?: CardItem[]
  initialIndex?: number
  onCardChange?: (index: number) => void
  onBuyNow?: (card: CardItem) => void
  className?: string
}

export function CardSwipe({
  cards = defaultCards,
  initialIndex = 0,
  onCardChange,
  onBuyNow,
  className = '',
}: CardSwipeProps) {
  const count = cards.length
  const lastIndex = Math.max(0, count - 1)

  // The single source of truth for which product is showcased.
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, cards.length - 1)),
  )
  const activeRef = useRef(activeIndex)

  const stageRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLDivElement | null)[]>([])
  const position = useRef(activeIndex)
  const velocity = useRef(0)
  const target = useRef(activeIndex)
  const frame = useRef(0)
  const lastFrameTime = useRef(0)
  const reduceMotion = useRef(false)
  const drag = useRef<DragState | null>(null)
  const suppressClick = useRef(false)

  const onCardChangeRef = useRef(onCardChange)
  useEffect(() => {
    onCardChangeRef.current = onCardChange
  })

  // Server render and first client render get the resting poses. They are frozen
  // so a re-render never writes over what the animation loop has put there.
  const [initialPoses] = useState(() => cards.map((_, i) => poseFor(i - activeIndex, false)))

  const paint = useCallback(() => {
    const p = position.current
    slideRefs.current.forEach((el, i) => {
      if (!el) return
      const pose = poseFor(i - p, reduceMotion.current)
      el.style.transform = pose.transform
      el.style.opacity = String(pose.opacity)
      el.style.zIndex = String(pose.zIndex)
      el.style.visibility = pose.visibility
      el.style.setProperty('--cf-veil', pose['--cf-veil'])
    })
  }, [])

  const tick = useCallback(
    (now: number) => {
      const dt = Math.min(0.032, Math.max(0.001, (now - lastFrameTime.current) / 1000))
      lastFrameTime.current = now
      const displacement = position.current - target.current
      velocity.current += (-SPRING.stiffness * displacement - SPRING.damping * velocity.current) * dt
      position.current += velocity.current * dt

      if (Math.abs(position.current - target.current) < 0.0005 && Math.abs(velocity.current) < 0.005) {
        position.current = target.current
        velocity.current = 0
        frame.current = 0
        paint()
        return
      }
      paint()
      frame.current = requestAnimationFrame(tick)
    },
    [paint],
  )

  const springTo = useCallback(
    (index: number, fromVelocity?: number) => {
      target.current = index
      if (fromVelocity !== undefined) velocity.current = fromVelocity

      if (reduceMotion.current) {
        cancelAnimationFrame(frame.current)
        frame.current = 0
        position.current = index
        velocity.current = 0
        paint()
        return
      }
      if (!frame.current) {
        lastFrameTime.current = performance.now()
        frame.current = requestAnimationFrame(tick)
      }
    },
    [paint, tick],
  )

  /** Every way of moving - drag, arrows, dots, keys, focus - ends up here. */
  const goTo = useCallback(
    (index: number, fromVelocity?: number) => {
      const next = Math.min(Math.max(0, index), lastIndex)
      springTo(next, fromVelocity)
      if (next !== activeRef.current) {
        activeRef.current = next
        setActiveIndex(next)
        onCardChangeRef.current?.(next)
      }
    },
    [lastIndex, springTo],
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reduceMotion.current = query.matches
      if (!frame.current) paint()
    }
    sync()
    query.addEventListener('change', sync)
    return () => {
      query.removeEventListener('change', sync)
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [paint])

  // Keep the showcased index valid if the product list changes underneath.
  useEffect(() => {
    if (activeRef.current > lastIndex) goTo(lastIndex)
    else paint()
  }, [count, lastIndex, goTo, paint])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const card = slideRefs.current[activeRef.current] ?? slideRefs.current.find(Boolean)
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPosition: position.current,
      // One neighbour-distance of travel moves exactly one card.
      step: (card?.offsetWidth || 320) * POSE.x[1],
      dragging: false,
      samples: [{ t: e.timeStamp, x: e.clientX }],
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return

    if (!d.dragging) {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.abs(dx) < DRAG_START_PX && Math.abs(dy) < DRAG_START_PX) return
      // Mostly vertical: the visitor is scrolling the page, not the carousel.
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current = null
        return
      }
      // Grab the cards wherever they are, even mid-spring.
      d.dragging = true
      d.startX = e.clientX
      d.startPosition = position.current
      cancelAnimationFrame(frame.current)
      frame.current = 0
      velocity.current = 0
      suppressClick.current = true
      stageRef.current?.setPointerCapture(e.pointerId)
      stageRef.current?.classList.add('is-dragging')
    }

    position.current = rubberBand(d.startPosition - (e.clientX - d.startX) / d.step, lastIndex)
    paint()

    d.samples.push({ t: e.timeStamp, x: e.clientX })
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift()
  }

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    if (!d.dragging) return

    const stage = stageRef.current
    stage?.classList.remove('is-dragging')
    if (stage?.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId)

    const first = d.samples[0]
    const last = d.samples[d.samples.length - 1]
    // A pointer held still before release has no throw left in it.
    const stale = e.timeStamp - last.t > 80
    const pxPerMs = stale ? 0 : (last.x - first.x) / Math.max(1, last.t - first.t)
    const indexPerSecond = (-pxPerMs * 1000) / d.step

    let next = Math.round(position.current + indexPerSecond * THROW_PROJECTION_S)
    const from = Math.round(d.startPosition)
    if (next === from && Math.abs(pxPerMs) > FLICK_PX_PER_MS) next = from + (pxPerMs < 0 ? 1 : -1)

    goTo(next, indexPerSecond)
    // The click that ends a drag must not press whatever is under the pointer.
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
  }

  const handleSlideClickCapture = (index: number) => (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    // A side card is brought forward first; its Buy Now works once it's showcased.
    if (index !== activeRef.current) {
      e.preventDefault()
      e.stopPropagation()
      goTo(index)
    }
  }

  const handleSlideFocusCapture = (index: number) => (e: React.FocusEvent) => {
    // Tabbing into a side card's button brings that card to the centre.
    if (index !== activeRef.current && (e.target as HTMLElement).matches(':focus-visible')) goTo(index)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') goTo(activeRef.current - 1)
    else if (e.key === 'ArrowRight') goTo(activeRef.current + 1)
    else if (e.key === 'Home') goTo(0)
    else if (e.key === 'End') goTo(lastIndex)
    else return
    e.preventDefault()
  }

  const activeCard = cards[activeIndex]

  return (
    <div
      className={`f9-card-swipe-container f9-cf ${className}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Femi9 Product Cards Carousel"
      aria-roledescription="carousel"
      role="region"
    >
      <div className="f9-cf__viewport">
        <div
          ref={stageRef}
          className="f9-cf__stage"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          {cards.map((card, idx) => (
            <div
              key={card.id ?? idx}
              ref={(el) => {
                slideRefs.current[idx] = el
              }}
              className={`f9-cf__slide${idx === activeIndex ? ' is-active' : ''}`}
              style={initialPoses[idx] ?? poseFor(idx - activeIndex, false)}
              role="group"
              aria-roledescription="slide"
              aria-label={`${idx + 1} of ${count}: ${card.title}`}
              onClickCapture={handleSlideClickCapture(idx)}
              onFocusCapture={handleSlideFocusCapture(idx)}
            >
              <CarouselCard card={card} isActive={idx === activeIndex} index={idx} onBuyNow={onBuyNow} />
            </div>
          ))}
        </div>
      </div>

      <p className="f9-cf__status" aria-live="polite">
        {activeCard ? `${activeCard.title}, ${activeIndex + 1} of ${count}` : ''}
      </p>

      {/* Pagination & Arrow Controls */}
      <div className="f9-cf__controls">
        <div className="f9-cf__dots">
          {cards.map((card, dotIdx) => (
            <button
              key={card.id ?? dotIdx}
              type="button"
              className={`f9-cf__dot${dotIdx === activeIndex ? ' is-active' : ''}`}
              onClick={() => goTo(dotIdx)}
              aria-label={`Go to slide ${dotIdx + 1}`}
              aria-current={dotIdx === activeIndex ? 'true' : undefined}
            />
          ))}
        </div>

        <div className="f9-cf__arrows">
          <button
            type="button"
            className="f9-cf__arrow"
            onClick={() => goTo(activeRef.current - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous card"
          >
            ←
          </button>
          <button
            type="button"
            className="f9-cf__arrow"
            onClick={() => goTo(activeRef.current + 1)}
            disabled={activeIndex >= lastIndex}
            aria-label="Next card"
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
}

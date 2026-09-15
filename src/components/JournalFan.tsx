'use client'

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link } from '@/lib/router-compat'
import { BlogCover } from './BlogCover'
import type { BlogPostDTO } from '@femi9/core/services/blog'
import './JournalFan.css'

/**
 * The journal's article browser: a fanned stack of closed "notebooks" with the
 * current article open in the middle as a two-page spread (cover left, words
 * right). Moving to another article slides the fan and swings the new spread's
 * page open from the spine. Swipe, drag, arrow keys, the arrow buttons, or a
 * click on any closed card all move it.
 */

/** Closed cards drawn each side of the open one; the rest wait out of sight. */
const SIDE_CARDS = 5
/** Horizontal drag, in px, that turns to the next article on release. */
const SWIPE_PX = 40
/** Card widths between the open spread's outer edge and the first closed card. */
const GAP = 0.05
/** Card widths between one closed card and the next. Small on purpose: steeply
 *  tilted, each card reads as a sliver, and they overlap into a fanned stack. */
const STEP = 0.1
const COVER_SIZES = '(max-width: 640px) 45vw, 340px'

/**
 * Where a card sits for its distance `d` from the open one. `x` is in card
 * widths from the stage centre to the card's left edge; the open card sits one
 * width left of centre so the spine of its spread lands on the centre line.
 */
function place(d: number) {
  const ad = Math.min(Math.abs(d), SIDE_CARDS + 1)
  if (d === 0) return { x: -1, ry: 0, sc: 1, z: 0, ox: '100%', ad }
  const reach = GAP + (ad - 1) * STEP
  // Each card further out sits a little smaller and deeper, so the stack recedes.
  const sc = 0.9 - (ad - 1) * 0.03
  return d > 0
    ? { x: 1 + reach, ry: -58, sc, z: -ad * 60, ox: '0%', ad }
    : { x: -2 - reach, ry: 58, sc, z: -ad * 60, ox: '100%', ad }
}

function Arrow({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={dir === 'prev' ? 'M15 5 8 12l7 7' : 'm9 5 7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function JournalFan({ posts }: { posts: BlogPostDTO[] }) {
  const count = posts.length
  const [active, setActive] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; dx: number; moved: boolean } | null>(null)
  const swallowClickUntil = useRef(0)

  // A different topic is a different set of articles: open its first one.
  useEffect(() => {
    setActive(0)
  }, [posts])

  const go = (i: number) => setActive(Math.max(0, Math.min(count - 1, i)))
  // Relative moves read the latest index, so presses that land before a
  // re-render each still count.
  const step = (delta: number) => setActive((a) => Math.max(0, Math.min(count - 1, a + delta)))

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, dx: 0, moved: false }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const stage = stageRef.current
    if (!d || !stage || e.pointerId !== d.id) return
    d.dx = e.clientX - d.x
    if (!d.moved) {
      if (Math.abs(d.dx) < 8) return
      d.moved = true
      // Captured only once it is a drag, so a plain click still reaches the card.
      stage.setPointerCapture(e.pointerId)
      stage.classList.add('is-dragging')
    }
    // The fan leans with the finger, damped, so the swipe is felt before it commits.
    stage.style.setProperty('--drag', `${d.dx * 0.35}px`)
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const stage = stageRef.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.moved || !stage) return
    stage.classList.remove('is-dragging')
    stage.style.removeProperty('--drag')
    swallowClickUntil.current = e.timeStamp + 400
    if (Math.abs(d.dx) >= SWIPE_PX) step(d.dx < 0 ? 1 : -1)
  }

  // A drag ends with a click on whichever card it was released over; swallow it.
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.timeStamp < swallowClickUntil.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    }
  }

  if (count === 0) return <p className="jfan-empty">No articles in this topic yet.</p>

  const current = posts[Math.min(active, count - 1)]

  return (
    <div className="jfan" role="region" aria-roledescription="carousel" aria-label="Latest journal articles">
      <div
        className="jfan-stage"
        ref={stageRef}
        role="group"
        tabIndex={0}
        aria-label="Articles. Use the left and right arrow keys to browse."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {posts.map((p, i) => {
          const d = i - active
          const pl = place(d)
          const open = d === 0
          return (
            <div
              key={p.slug}
              className={`jfan-item${open ? ' is-open' : ''}${pl.ad > SIDE_CARDS ? ' is-hidden' : ''}`}
              data-ad={pl.ad}
              style={
                {
                  '--x': pl.x,
                  '--ry': pl.ry,
                  '--sc': pl.sc,
                  '--z': pl.z,
                  '--ox': pl.ox,
                  zIndex: 50 - pl.ad,
                } as CSSProperties
              }
              aria-hidden={!open || undefined}
            >
              <Link
                to={`/blog/${p.slug}`}
                className="jfan-cover"
                tabIndex={-1}
                onClick={(e) => {
                  if (!open) {
                    e.preventDefault()
                    go(i)
                  }
                }}
              >
                <BlogCover post={p} sizes={COVER_SIZES} />
              </Link>
              <Link to={`/blog/${p.slug}`} className="jfan-page" tabIndex={open ? 0 : -1}>
                {p.category && <span className="jfan-cat">{p.category}</span>}
                <h3>{p.title}</h3>
                <p className="jfan-excerpt">{p.excerpt}</p>
                <span className="jfan-meta">
                  {p.author} · {p.date} · {p.readTime} min read
                </span>
                <span className="jfan-read">
                  Read article <span aria-hidden="true">→</span>
                </span>
              </Link>
            </div>
          )
        })}
      </div>

      <div className="jfan-controls">
        <button
          type="button"
          className="jfan-arrow"
          onClick={() => step(-1)}
          disabled={active === 0}
          aria-label="Previous article"
        >
          <Arrow dir="prev" />
        </button>
        <p className="jfan-count" aria-live="polite">
          <b>{String(active + 1).padStart(2, '0')}</b> / {String(count).padStart(2, '0')}
          <span className="jfan-sr">: {current.title}</span>
        </p>
        <button
          type="button"
          className="jfan-arrow"
          onClick={() => step(1)}
          disabled={active === count - 1}
          aria-label="Next article"
        >
          <Arrow dir="next" />
        </button>
      </div>
    </div>
  )
}

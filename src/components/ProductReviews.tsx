'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { IStar, IThumbUp, IThumbDown, IChevron } from './AppIcons'
import type { ProductReview } from '@femi9/core/services/products'

/**
 * "Customer Reviews" — a pinned stack of paper notes beside the rating summary.
 *
 * The reviews sit on top of one another like notes pinned to a board. Clicking
 * the top note (or the next arrow) sends it to the back of the stack and
 * reveals the one underneath; the previous arrow brings the last one forward
 * again. The stack cycles, so the end of the set leads back to the start.
 *
 * Data flow is unchanged from the carousel this replaced: reviews arrive as a
 * prop, helpful votes post to `/api/reviews/[id]/vote` and are remembered
 * locally, and the two actions call back into ProductDetail's existing modal.
 *
 * • Stacked with CSS grid (every note in the same cell), so the stack is as tall
 *   as its tallest review with no measuring — a long review never overflows.
 * • Only the top note is interactive. The others are `inert`, so the vote
 *   buttons of a hidden review cannot be tabbed to or clicked through.
 */

interface Props {
  reviews: ProductReview[]
  /** Average across the moderated set; falls back to the catalog's own rating. */
  averageRating: number
  reviewTotal: number
  onWriteReview: () => void
  onAskQuestion: () => void
}

/** localStorage key holding the review ids this browser has already voted on. */
const VOTED_KEY = 'femi9:review-votes'

/** Depths past this share one resting pose, hidden behind the visible three. */
const MAX_VISIBLE_DEPTH = 3

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={`rv-stars${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`Rated ${rating.toFixed(1)} out of 5`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <IStar key={i} className={i < Math.round(rating) ? 'rv-star rv-star--on' : 'rv-star'} />
      ))}
    </span>
  )
}

/** Reviews this browser has voted on, as `{ id: 'up' | 'down' }`. */
function readVoted(): Record<string, 'up' | 'down'> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(VOTED_KEY)
    return raw ? (JSON.parse(raw) as Record<string, 'up' | 'down'>) : {}
  } catch {
    // A quota-exceeded or disabled store must not take the section down with it.
    return {}
  }
}

function ReviewCard({
  review,
  voted,
  onVote,
}: {
  review: ProductReview
  voted?: 'up' | 'down'
  onVote: (id: string, helpful: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  // Only offer the expander when there is genuinely something behind it; the
  // note clamps the body to six lines.
  const isLong = review.body.length > 280

  // Tallies are optimistic: the vote is a single counter bump that essentially
  // cannot fail business-side, and a number that waits for a round-trip before
  // moving reads as a dead button.
  const [tally, setTally] = useState({ up: review.helpfulUp, down: review.helpfulDown })

  const vote = (helpful: boolean) => {
    if (voted) return
    setTally((t) => (helpful ? { ...t, up: t.up + 1 } : { ...t, down: t.down + 1 }))
    onVote(review.id, helpful)
  }

  return (
    <article className="rv-card">
      <header className="rv-card-head">
        <Stars rating={review.rating} />
        <time className="rv-date">{review.date}</time>
      </header>

      {/* The headline is optional — rows written before the column existed have
          none — so the body simply moves up when it is absent. */}
      {review.title && <h3 className="rv-title">{review.title}</h3>}

      <p className={`rv-body${expanded ? ' rv-body--open' : ''}`}>{review.body}</p>

      {isLong && (
        <button type="button" className="rv-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Full Review'}
        </button>
      )}

      <div className="rv-author">
        <span className="rv-avatar" aria-hidden="true">
          {review.name.charAt(0).toUpperCase()}
        </span>
        <span className="rv-author-text">
          <span className="rv-author-name">{review.name}</span>
          <span className="rv-source">
            {review.verified ? 'Verified purchase' : 'Review collected from a store visitor'}
          </span>
        </span>
      </div>

      <footer className="rv-card-foot">
        <span className="rv-helpful-label">Was this helpful?</span>
        <div className="rv-votes">
          <button
            type="button"
            className={`rv-vote${voted === 'up' ? ' rv-vote--cast' : ''}`}
            onClick={() => vote(true)}
            disabled={Boolean(voted)}
            aria-label={`Mark ${review.name}'s review helpful`}
          >
            <IThumbUp /> <span>{tally.up}</span>
          </button>
          <button
            type="button"
            className={`rv-vote${voted === 'down' ? ' rv-vote--cast' : ''}`}
            onClick={() => vote(false)}
            disabled={Boolean(voted)}
            aria-label={`Mark ${review.name}'s review unhelpful`}
          >
            <IThumbDown /> <span>{tally.down}</span>
          </button>
        </div>
      </footer>
    </article>
  )
}

export function ProductReviews({
  reviews,
  averageRating,
  reviewTotal,
  onWriteReview,
  onAskQuestion,
}: Props) {
  const count = reviews.length
  const [active, setActive] = useState(0)
  /** The note currently animating between the top and the back of the stack. */
  const [motion, setMotion] = useState<{ index: number; dir: 'back' | 'front' } | null>(null)
  const [voted, setVoted] = useState<Record<string, 'up' | 'down'>>({})
  const liveRef = useRef<HTMLParagraphElement>(null)

  // localStorage is not available during SSR, so the voted map starts empty and
  // fills in on mount. Reading it inline would make the server and client render
  // different button states and trip a hydration mismatch.
  useEffect(() => setVoted(readVoted()), [])

  // A shorter review set (after moderation, say) must not leave the index past the end.
  const top = count ? active % count : 0

  const flip = useCallback(
    (dir: 'next' | 'prev') => {
      if (count < 2) return
      if (dir === 'next') {
        setMotion({ index: top, dir: 'back' })
        setActive((top + 1) % count)
      } else {
        const prev = (top - 1 + count) % count
        setMotion({ index: prev, dir: 'front' })
        setActive(prev)
      }
    },
    [count, top],
  )

  // Announce the change. The notes swap without moving focus, so a screen reader
  // would otherwise get no indication that the content changed at all.
  useEffect(() => {
    if (liveRef.current && count > 1) liveRef.current.textContent = `Review ${top + 1} of ${count}`
  }, [top, count])

  /** Clicking the note itself flips it — unless the click was on one of its controls. */
  const onDeckClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    flip('next')
  }

  const histogram = useMemo(
    () =>
      [5, 4, 3, 2, 1].map((stars) => {
        const n = reviews.filter((r) => Math.round(r.rating) === stars).length
        return { stars, count: n, pct: reviews.length ? Math.round((n / reviews.length) * 100) : 0 }
      }),
    [reviews],
  )

  const castVote = useCallback(async (id: string, helpful: boolean) => {
    // Record locally FIRST so a failed request still settles the control. The
    // server holds the authoritative one-vote-per-visitor constraint; this is
    // only here to stop the same browser re-arming the button on every render.
    setVoted((v) => {
      const next = { ...v, [id]: helpful ? ('up' as const) : ('down' as const) }
      try {
        window.localStorage.setItem(VOTED_KEY, JSON.stringify(next))
      } catch {
        // Private-mode quota. The vote still posts; only the memory is lost.
      }
      return next
    })

    try {
      await fetch(`/api/reviews/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      })
      // A 409 (already voted) needs no handling: the control is already settled
      // and the tally the visitor sees is the one their own vote produced.
    } catch {
      // Offline or blocked. Nothing to surface — a helpfulness vote is not work
      // the shopper needs to know failed.
    }
  }, [])

  if (count === 0) {
    return (
      <section className="rv-section" aria-labelledby="rv-heading">
        <h2 className="rv-heading" id="rv-heading">
          Customer Reviews
        </h2>
        <div className="rv-empty">
          <p>No reviews yet for this product.</p>
          <button type="button" className="rv-btn rv-btn--solid" onClick={onWriteReview}>
            Be the first to review it
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rv-section" aria-labelledby="rv-heading">
      <h2 className="rv-heading" id="rv-heading">
        Customer Reviews
      </h2>

      <div className="rv-layout">
        <div className="rv-deck">
          <span className="rv-pin" aria-hidden="true" />

          <div
            className={`rv-deck-stack${count > 1 ? ' is-flippable' : ''}`}
            onClick={onDeckClick}
          >
            {reviews.map((r, i) => {
              const depth = (i - top + count) % count
              const moving = motion?.index === i ? ` is-${motion.dir}` : ''
              return (
                <div
                  key={r.id}
                  className={`rv-paper rv-paper--d${Math.min(depth, MAX_VISIBLE_DEPTH)}${moving}`}
                  style={{ zIndex: count - depth }}
                  aria-hidden={depth !== 0}
                  inert={depth !== 0}
                  onAnimationEnd={() => setMotion((m) => (m?.index === i ? null : m))}
                >
                  <ReviewCard review={r} voted={voted[r.id]} onVote={castVote} />
                </div>
              )
            })}
          </div>

          {count > 1 && (
            <div className="rv-deck-nav">
              <button
                type="button"
                className="rv-arrow rv-arrow--prev"
                onClick={() => flip('prev')}
                aria-label="Previous review"
              >
                <IChevron />
              </button>
              <span className="rv-deck-count">
                {top + 1} / {count}
              </span>
              <button
                type="button"
                className="rv-arrow rv-arrow--next"
                onClick={() => flip('next')}
                aria-label="Next review"
              >
                <IChevron />
              </button>
            </div>
          )}
          {count > 1 && <p className="rv-deck-hint">Tap the note to see the next review</p>}
        </div>

        <p ref={liveRef} className="rv-sr-only" role="status" aria-live="polite" />

        <aside className="rv-summary" aria-label="Rating summary">
          <div className="rv-summary-score">
            <Stars rating={averageRating} className="rv-stars--lg" />
            <span className="rv-score-value">{averageRating.toFixed(2)} out of 5</span>
            <span className="rv-score-count">
              Based on {reviewTotal} {reviewTotal === 1 ? 'review' : 'reviews'}
            </span>
          </div>

          <div className="rv-summary-bars">
            {histogram.map((row) => (
              <div className="rv-bar-row" key={row.stars}>
                <Stars rating={row.stars} className="rv-stars--sm" />
                <span className="rv-bar-track">
                  <span className="rv-bar-fill" style={{ width: `${row.pct}%` }} />
                </span>
                <span className="rv-bar-count">{row.count}</span>
              </div>
            ))}
          </div>

          <div className="rv-summary-actions">
            <button type="button" className="rv-btn rv-btn--solid" onClick={onWriteReview}>
              Write a Review
            </button>
            <button type="button" className="rv-btn rv-btn--outline" onClick={onAskQuestion}>
              Ask a Question
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}

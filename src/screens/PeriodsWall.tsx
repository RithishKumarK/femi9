'use client'
import '../styles/periods-wall.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@/lib/router-compat'
import type { WallPostDTO } from '@femi9/core/services/wall'

/* ============================================================
   PERIODS WALL — a warm, judgment-free community wall where
   people share honest experiences with period products.
   Posts are now stored in Postgres and moderated: submissions
   land as "pending" and appear only after an admin approves
   them, so the compose form shows an "awaiting review" state
   rather than optimistically prepending the new story.
   ============================================================ */

interface Props {
  // Approved posts are fetched by the server page and passed in as props.
  posts: WallPostDTO[]
}

/* View-model the cards render — mapped from the DTO (createdAt ISO → ts number,
   likeCount → likes). Replies aren't wired yet, so the count is 0. */
type Post = {
  id: string
  name: string // real name, or "Anonymous"
  handle: string // gentle alias (used as display name when anonymous)
  product: string // what they used (may be "")
  rating: number // 0 = no rating, else 1–5
  body: string
  ts: number
  likes: number
}

/* ---------- compose options ---------- */
const PRODUCTS = ['Femi9 330mm', 'Femi9 290mm', 'Femi9 Pantyliner', 'Another brand', 'First period']

/* ---------- feed filters ---------- */
const FILTERS = ['All', 'Femi9', 'Cramps', 'First period', 'Heavy days', 'Switching', 'Sensitive skin'] as const
type FilterName = (typeof FILTERS)[number]

const FILTER_KEYWORDS: Record<string, string[]> = {
  Cramps: ['cramp', 'pain', 'ache', 'sore'],
  'First period': ['first period', 'first-ever', 'first time', 'menarche', 'started'],
  'Heavy days': ['heavy', 'flow', 'night', 'leak', 'overnight', 'gush'],
  Switching: ['switch', 'another brand', 'other brand', 'used to', 'earlier', 'moved'],
  'Sensitive skin': ['sensitive', 'rash', 'irritat', 'skin', 'itch', 'chafe'],
}

/* ---------- time-ago helper ---------- */
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  return `${w}w ago`
}

/* ---------- icons ---------- */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`pw-star-svg${filled ? ' is-on' : ''}`}>
      <path d="M12 2.4l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 18.98 6.12 21.07l1.12-6.55-4.76-4.64 6.58-.96z" />
    </svg>
  )
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`pw-heart-svg${filled ? ' is-on' : ''}`}>
      <path d="M12 20.6l-1.42-1.28C5.6 14.86 2.5 12.06 2.5 8.6 2.5 6 4.53 4 7.1 4c1.5 0 2.96.7 3.9 1.82C11.94 4.7 13.4 4 14.9 4 17.47 4 19.5 6 19.5 8.6c0 3.46-3.1 6.26-8.08 10.72z" />
    </svg>
  )
}

function LotusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pw-anon-svg">
      <path d="M12 3c1.5 1.7 2.3 3.4 2.3 5.2 0 .9-.2 1.7-.6 2.6.9-.3 1.7-.9 2.5-1.8 1.2 1.6 1.5 3.2 1 4.9 1-.2 1.9-.7 2.8-1.5.3 2-.5 3.7-2.2 5-1.7 1.3-3.6 1.9-5.8 1.9s-4.1-.6-5.8-1.9c-1.7-1.3-2.5-3-2.2-5 .9.8 1.8 1.3 2.8 1.5-.5-1.7-.2-3.3 1-4.9.8.9 1.6 1.5 2.5 1.8-.4-.9-.6-1.7-.6-2.6C9.7 6.4 10.5 4.7 12 3z" />
    </svg>
  )
}

/* ---------- read-only star row ---------- */
function StarRow({ value }: { value: number }) {
  if (!value) return null
  return (
    <span className="pw-stars-view" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} filled={value >= n} />
      ))}
    </span>
  )
}

/* ---------- one feed card ---------- */
function PostCard({
  post,
  liked,
  onToggleLike,
}: {
  post: Post
  liked: boolean
  onToggleLike: (id: string) => void
}) {
  const isAnon = post.name === 'Anonymous'
  const displayName = isAnon ? post.handle : post.name
  const tone = ([...displayName].reduce((a, c) => a + c.charCodeAt(0), 0)) % 4
  // Optimistic +1 while a like request is in flight / after it lands.
  const likeCount = post.likes + (liked ? 1 : 0)

  return (
    <article className="pw-card" data-tone={tone}>
      <header className="pw-card-head">
        <div className="pw-avatar" aria-hidden="true">
          {isAnon ? <LotusIcon /> : displayName.charAt(0).toUpperCase()}
        </div>
        <div className="pw-who">
          <span className="pw-name">{displayName}</span>
          <span className="pw-meta">
            {isAnon ? 'shared anonymously' : `@${post.handle}`}
            <i className="pw-dot" />
            {timeAgo(post.ts)}
          </span>
        </div>
      </header>

      {(post.product || post.rating) && (
        <div className="pw-tags">
          {post.product && <span className="pw-product">{post.product}</span>}
          <StarRow value={post.rating} />
        </div>
      )}

      <p className="pw-body">{post.body}</p>

      <footer className="pw-card-foot">
        <button
          type="button"
          className={`pw-heart${liked ? ' is-liked' : ''}`}
          aria-pressed={liked}
          aria-label={liked ? `Liked, ${likeCount} likes` : `Like, ${likeCount} likes`}
          onClick={() => onToggleLike(post.id)}
        >
          <HeartIcon filled={liked} />
          <span>{likeCount}</span>
        </button>
      </footer>
    </article>
  )
}

/* ============================================================
   PAGE
   ============================================================ */
export function PeriodsWall({ posts }: Props) {
  // Map the server DTOs into the card view-model once per prop change.
  const viewPosts = useMemo<Post[]>(
    () =>
      posts.map((p) => ({
        id: p.id,
        name: p.name,
        handle: p.handle,
        product: p.product,
        rating: p.rating,
        body: p.body,
        ts: Date.parse(p.createdAt),
        likes: p.likeCount,
      })),
    [posts],
  )

  const [filter, setFilter] = useState<FilterName>('All')
  /** Carousel: index of the story shown sharp in the centre. UI state only. */
  const [active, setActive] = useState(0)
  /** Swipe: where the pointer went down, and how far it has dragged (px).
   *  `dx` is null until the pointer has moved far enough to count as a drag,
   *  so a plain click still reaches the like button or a side card. */
  const swipe = useRef<{ id: number; x: number; dragging: boolean } | null>(null)
  const [dragX, setDragX] = useState<number | null>(null)
  // Likes are one-way per session (the server just increments; there's no guest
  // dedupe), so a liked id stays liked and repeat clicks are ignored.
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set())
  // Surfaced above the feed when a like is refused — most often a 401.
  const [likeError, setLikeError] = useState<string | null>(null)

  // compose form
  const [name, setName] = useState('')
  const [product, setProduct] = useState('')
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])

  const visible = useMemo(() => {
    if (filter === 'All') return viewPosts
    if (filter === 'Femi9') return viewPosts.filter((p) => p.product.toLowerCase().includes('femi9'))
    const kws = FILTER_KEYWORDS[filter] ?? [filter.toLowerCase()]
    return viewPosts.filter((p) => {
      const hay = `${p.product} ${p.body}`.toLowerCase()
      return kws.some((k) => hay.includes(k))
    })
  }, [viewPosts, filter])

  // A new filter is a new set of stories: start again from its first one.
  useEffect(() => setActive(0), [filter])

  const count = visible.length
  const centre = count ? ((active % count) + count) % count : 0
  const go = (delta: number) => {
    if (count < 2) return
    setActive((a) => (((a + delta) % count) + count) % count)
  }
  /** Signed distance from the centre story, wrapping round, so the stories
   *  either side are always ±1 and the rest wait just beyond at ±2. */
  const offsetOf = (i: number) => {
    let off = (((i - centre) % count) + count) % count
    if (off > count / 2) off -= count
    return Math.max(-2, Math.min(2, off))
  }

  /**
   * Like a post once. Optimistically marks it liked, then POSTs.
   *
   * The endpoint requires a session. It used to revert the heart silently on any
   * failure, so a signed-out visitor watched it fill and un-fill with no
   * explanation at all — she had no way to know she needed to sign in. A 401
   * now says so and offers the way back to this page.
   */
  function like(id: string) {
    if (likedIds.has(id)) return
    setLikeError(null)
    setLikedIds((prev) => new Set(prev).add(id))

    const revert = () =>
      setLikedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })

    fetch(`/api/wall/${id}/like`, { method: 'POST' })
      .then((r) => {
        if (r.status === 401) {
          revert()
          setLikeError('Sign in to like a story.')
          return
        }
        if (!r.ok) {
          revert()
          setLikeError('We could not save that like. Please try again.')
        }
      })
      .catch(() => {
        revert()
        setLikeError('We could not reach the server. Please check your connection.')
      })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text || submitting) return // ignore empty / in-flight submissions

    const trimmedName = name.trim()
    const isAnonymous = trimmedName.length === 0

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/wall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // No alias when anonymous — the server mints a gentle one.
          alias: isAnonymous ? undefined : trimmedName,
          isAnonymous,
          product: product || undefined,
          rating: rating || undefined,
          body: text,
          tags: [],
        }),
      })
      if (!res.ok) {
        // The wall accepts guests, so there is no 401 here — but it IS rate
        // limited at 5/min per IP, and a throttled story used to read as a
        // generic failure the visitor would answer by pressing submit again.
        // Say what actually happened, and how long to wait.
        if (res.status === 429) {
          const payload = (await res.json().catch(() => ({}))) as { retryAfterSec?: number }
          const wait = payload.retryAfterSec
          setError(
            wait
              ? `You have shared a few stories just now. Please try again in ${wait} seconds.`
              : 'You have shared a few stories just now. Please try again shortly.',
          )
          return
        }
        setError('Something went wrong - please try again.')
        return
      }

      // Reset the form. The post is pending review, so it is NOT added to the
      // feed — instead we surface an "awaiting review" acknowledgement.
      setName('')
      setProduct('')
      setRating(0)
      setHoverRating(0)
      setBody('')

      setConfirmed(true)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmed(false), 6000)
    } catch {
      setError('We could not reach the server. Please check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="pwall">
      {/* ---------- hero ---------- */}
      <header className="wrap pwall-hero">
        <span className="eyebrow">Periods Wall</span>
        <h1 className="display pwall-title">Real period stories, no judgment.</h1>
        <p className="pwall-sub">
          A gentle corner of Femi9 where people across India share how their days really go -
          with our pads or whatever they used before. Read, relate, and add your own.
        </p>
        <p className="pwall-kind">
          <span aria-hidden="true"><HeartIcon filled /></span> Be kind. Every body and every flow is different.
        </p>
      </header>

      <section className="wrap pwall-body-wrap">
        {/* ---------- compose ---------- */}
        <form className="pw-compose" onSubmit={handleSubmit} noValidate>
          <h2 className="pw-compose-title">Share your experience</h2>
          <p className="pw-compose-sub">Two lines is plenty. Honest and kind is all we ask.</p>

          <label className="pw-sr-only" htmlFor="pw-name">
            Your name (optional)
          </label>
          <input
            id="pw-name"
            className="pw-input"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (or stay anonymous)"
          />

          <div className="pw-field">
            <span className="pw-label">What did you use?</span>
            <div className="pw-chips" role="group" aria-label="Choose a product">
              {PRODUCTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pw-chip${product === p ? ' is-active' : ''}`}
                  aria-pressed={product === p}
                  onClick={() => setProduct(product === p ? '' : p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="pw-field">
            <span className="pw-label">How would you rate it?</span>
            <div className="pw-stars" role="group" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="pw-star"
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  aria-pressed={rating === n}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  onFocus={() => setHoverRating(n)}
                  onBlur={() => setHoverRating(0)}
                  onClick={() => setRating(rating === n ? 0 : n)}
                >
                  <StarIcon filled={(hoverRating || rating) >= n} />
                </button>
              ))}
            </div>
          </div>

          <label className="pw-sr-only" htmlFor="pw-body">
            Your story
          </label>
          <textarea
            id="pw-body"
            className="pw-textarea"
            value={body}
            maxLength={600}
            rows={4}
            onChange={(e) => setBody(e.target.value)}
            placeholder="How did it go? Share honestly…"
          />

          <div className="pw-compose-foot">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Sharing…' : 'Post to the wall'}
            </button>
            <span className={`pw-confirm${confirmed || error ? ' is-shown' : ''}`} role="status" aria-live="polite">
              {error
                ? error
                : confirmed
                  ? 'Thank you for sharing. Your story is awaiting review and will appear once approved.'
                  : ''}
            </span>
          </div>
        </form>

        {/* Right column on desktop: filters, like error and the story carousel,
            beside the compose card. Stacks under it below 980px. */}
        <div className="pw-stories">
        {/* ---------- filters ---------- */}
        <div className="pw-filters" role="group" aria-label="Filter stories">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`pw-filter${filter === f ? ' is-active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {/* A refused like needs a visible reason. Signing out mid-session and
            tapping a heart used to fill and un-fill it with no message at all. */}
        {likeError && (
          <p className="pw-like-error" role="alert">
            {likeError}{' '}
            <Link to="/login?next=/periods-wall" className="pw-like-error-link">
              Sign in
            </Link>
          </p>
        )}

        {/* ---------- feed ---------- */}
        <div className="pw-feed">
          {visible.length === 0 ? (
            viewPosts.length === 0 ? (
              <div className="pw-empty">
                <p className="pw-empty-title">No stories yet.</p>
                <p className="pw-empty-sub">
                  Be the first to share how your days really go - your story appears here once it’s approved.
                </p>
              </div>
            ) : (
              <div className="pw-empty">
                <p className="pw-empty-title">Nothing here yet.</p>
                <p className="pw-empty-sub">
                  No stories under “{filter}” right now - try another filter, or be the first to write one.
                </p>
              </div>
            )
          ) : (
            /* Layered carousel: every story sits in the same spot; its offset
               from the centre story decides whether it is sharp in front,
               blurred at a side, or waiting out of view. Side cards are
               `inert`, so their like buttons cannot be reached by accident;
               an invisible button over each side card brings it to the front. */
            <div
              className="pw-carousel"
              role="region"
              aria-roledescription="carousel"
              aria-label="Period stories"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
                if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
              }}
            >
              <div
                className={`pw-stage${count > 1 ? ' is-swipeable' : ''}`}
                data-dragging={dragX !== null ? 'true' : undefined}
                style={{ '--drag': dragX ?? 0 } as React.CSSProperties}
                onPointerDown={(e) => {
                  if (count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return
                  swipe.current = { id: e.pointerId, x: e.clientX, dragging: false }
                }}
                onPointerMove={(e) => {
                  const s = swipe.current
                  if (!s || s.id !== e.pointerId) return
                  const dx = e.clientX - s.x
                  if (!s.dragging) {
                    if (Math.abs(dx) < 8) return
                    // Now it is a drag: capture so it continues off the card.
                    s.dragging = true
                    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
                  }
                  setDragX(dx)
                }}
                onPointerUp={(e) => {
                  const s = swipe.current
                  swipe.current = null
                  if (!s || !s.dragging) return
                  const dx = e.clientX - s.x
                  setDragX(null)
                  // A quarter of the card, or 70px, whichever is less, flips it.
                  const card = e.currentTarget.querySelector('.pw-slide[data-state="centre"]')
                  const threshold = Math.min(70, (card?.clientWidth ?? 400) * 0.25)
                  if (Math.abs(dx) > threshold) go(dx < 0 ? 1 : -1)
                }}
                onPointerCancel={() => {
                  swipe.current = null
                  setDragX(null)
                }}
                onClickCapture={(e) => {
                  // Swallow the click that ends a drag, so a swipe that lets go
                  // over a side card does not also select it.
                  if (dragX !== null) e.stopPropagation()
                }}
              >
                {visible.map((post, i) => {
                  const off = offsetOf(i)
                  const state = off === 0 ? 'centre' : Math.abs(off) === 1 ? 'side' : 'hidden'
                  const who = post.name === 'Anonymous' ? post.handle : post.name
                  return (
                    <div
                      key={post.id}
                      className="pw-slide"
                      data-state={state}
                      style={{ '--off': off } as React.CSSProperties}
                      aria-hidden={off !== 0}
                    >
                      <div className="pw-slide-card" inert={off !== 0}>
                        <PostCard post={post} liked={likedIds.has(post.id)} onToggleLike={like} />
                      </div>
                      {state === 'side' && (
                        <button
                          type="button"
                          className="pw-slide-hit"
                          tabIndex={-1}
                          aria-label={`Show story from ${who}`}
                          onClick={() => setActive(i)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {count > 1 && (
                <div className="pw-carousel-nav">
                  <button type="button" className="pw-nav-btn" onClick={() => go(-1)} aria-label="Previous story">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
                  </button>
                  <span className="pw-nav-count" aria-hidden="true">{centre + 1} / {count}</span>
                  <button type="button" className="pw-nav-btn" onClick={() => go(1)} aria-label="Next story">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              )}
              <p className="pw-sr-only" aria-live="polite">
                {count > 1 ? `Story ${centre + 1} of ${count}` : ''}
              </p>
            </div>
          )}
        </div>
        </div>
      </section>
    </main>
  )
}

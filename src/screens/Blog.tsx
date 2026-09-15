'use client'
import { useMemo, useState } from 'react'
import { MosaicTile } from '../components/BlogCards'
import { JournalFan } from '../components/JournalFan'
import type { BlogPostDTO, BlogCategoryDTO } from '@femi9/core/services/blog'

interface Props {
  // Posts + category chips are now fetched by the server page from Postgres.
  posts: BlogPostDTO[]
  categories: BlogCategoryDTO[]
}

// 'All' plus any category name coming from the DB.
type Filter = string

export function Blog({ posts, categories }: Props) {
  const [filter, setFilter] = useState<Filter>('All')
  const [subscribed, setSubscribed] = useState(false)
  const [email, setEmail] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [signupError, setSignupError] = useState<string | null>(null)

  /**
   * The journal signup used to be `setSubscribed(true)` on an uncontrolled
   * input whose value was never read — the address went nowhere and the reader
   * was thanked for joining a list that did not exist. It now POSTs for real
   * and only confirms on a 2xx.
   */
  async function subscribe(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim()
    setSignupError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setSignupError('Enter a valid email address.')
      return
    }
    setSubscribing(true)
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source: 'journal' }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setSignupError(data.error ?? 'We could not sign you up just now. Please try again.')
        return
      }
      setEmail('')
      setSubscribed(true)
    } catch {
      setSignupError('We could not reach the server. Please check your connection.')
    } finally {
      setSubscribing(false)
    }
  }

  const featured = useMemo(() => posts.filter((p) => p.featured).slice(0, 5), [posts])
  const list = useMemo(
    () => (filter === 'All' ? posts : posts.filter((p) => p.category === filter)),
    [filter, posts],
  )

  return (
    <main className="blog" id="top">
      <header className="blog-hero wrap">
        <span className="eyebrow">The Femi9 Journal</span>
        <h1 className="display blog-hero-title">
          Notes on cycles, bodies &amp; living well.
        </h1>
        <p className="blog-hero-sub">
          Honest, judgment-free writing on periods, hormones and comfort, from our
          founder-doctor and the people who make Femi9.
        </p>
      </header>

      <section className="wrap">
        <div className="bmosaic">
          {/* The lead tile is above the fold at every viewport and is the
              listing's LCP element, so it fetches eagerly; the four companions
              stay lazy. */}
          {featured[0] && <MosaicTile post={featured[0]} big priority />}
          {featured.slice(1, 5).map((p) => (
            <MosaicTile key={p.slug} post={p} />
          ))}
        </div>
      </section>

      <section className="wrap blog-latest">
        <div className="blog-latest-head">
          <h2 className="display">The latest</h2>
          {/*
            These used to declare role="tablist"/role="tab" without a tabpanel,
            without aria-controls and without roving tabindex, so a mobile screen
            reader announced "tab 3 of 7" and then found no panel to move into.
            They are a filter, not a tab set: plain buttons with aria-pressed are
            both simpler and correct, and they keep normal Tab order.
          */}
          <div className="bchips" role="group" aria-label="Filter articles by topic">
            {(['All', ...categories.map((c) => c.name)] as Filter[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={filter === c}
                className={`bchip ${filter === c ? 'is-active' : ''}`}
                onClick={() => setFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <JournalFan posts={list} />
      </section>

      <section className="wrap">
        <div className="blog-news">
          <div>
            <h2 className="display">Care notes, in your inbox.</h2>
            <p>A gentle, occasional letter - cycle tips and new writing. No spam, ever.</p>
          </div>
          {subscribed ? (
            <p role="status" className="blog-news-confirm">Thanks - you’re on the list.</p>
          ) : (
            <>
            <form className="blog-news-form" onSubmit={subscribe} noValidate>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Your email address"
                aria-label="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={signupError ? true : undefined}
                aria-describedby={signupError ? 'blog-news-error' : undefined}
                disabled={subscribing}
                required
              />
              <button type="submit" className="btn btn-primary" disabled={subscribing}>
                {subscribing ? 'Subscribing…' : 'Subscribe'}
              </button>
            </form>
            {signupError && (
              <p id="blog-news-error" role="alert" className="blog-news-error">
                {signupError}
              </p>
            )}
            </>
          )}
        </div>
      </section>
    </main>
  )
}

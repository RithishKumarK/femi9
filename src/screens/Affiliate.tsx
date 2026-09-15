import '../styles/affiliate.css'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

/* ------------------------------------------------------------------ *
 * Femi9 — Creator / Affiliate Program.
 *
 * Server-tracked now: the application POSTs to /api/affiliate/apply (which
 * upserts a User + a pending Affiliate); codes are allocated by an admin on
 * approval and emailed out — there is no client-side code generation or
 * localStorage account anymore. Approved creators can look up their live
 * clicks/orders/earnings via /api/affiliate/me?code=CODE.
 * ------------------------------------------------------------------ */

const PLATFORMS = ['Instagram', 'YouTube', 'TikTok', 'X', 'Blog'] as const
const FOLLOWER_BANDS = ['Under 5k', '5–25k', '25–100k', '100k+'] as const

type StatsResult = {
  status: 'pending' | 'approved' | 'suspended'
  promoCode: string
  clicks: number
  orders: number
  earnings: number
}

/* ---------------- reveal-on-scroll (self-contained) ---------------- */

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Rise({
  children,
  className = '',
  delay = 0,
  id,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  delay?: number
  id?: string
  /** Rise is a wrapper, so it has to be able to BE the list item when it sits
   *  directly inside an <ol> — a <div> child makes the list expose zero items. */
  as?: 'div' | 'li'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(prefersReduced)

  useEffect(() => {
    if (prefersReduced) return
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setInView(true)
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node
      }}
      id={id}
      className={`af-rise${inView ? ' in' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}

/* ------------------------------- icons ------------------------------ */

const Ico = {
  tag: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.42.59l7 7a2 2 0 0 1 0 2.82l-6.5 6.5a2 2 0 0 1-2.82 0l-7-7A2 2 0 0 1 3 11.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  ),
  coin: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v9M14.4 9.3c-.6-.7-1.5-1-2.4-1-1.3 0-2.4.8-2.4 1.9 0 2.4 4.8 1.3 4.8 3.7 0 1.1-1.1 1.9-2.4 1.9-.9 0-1.8-.3-2.4-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="14.5" r="1.4" fill="currentColor" />
    </svg>
  ),
  gift: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="9.5" width="16" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9.5h18v3.2H3zM12 9.5v11M12 9.5C12 6.5 10.7 5 9 5S6 6.2 6 7.2 7.3 9.5 12 9.5Zm0 0c0-3 1.3-4.5 3-4.5s3 1.2 3 2.2-1.3 2.3-6 2.3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

/* ---------------------------- helpers ------------------------------ */

const inr = (n: number) => `Rs. ${n.toLocaleString('en-IN')}`
const num = (n: number) => n.toLocaleString('en-IN')

function statusLabel(status: StatsResult['status']): string {
  if (status === 'approved') return 'Approved · live'
  if (status === 'suspended') return 'Suspended'
  return 'Pending review'
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function Affiliate() {
  // application form state
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [platform, setPlatform] = useState<string[]>(['Instagram'])
  const [followers, setFollowers] = useState<string>(FOLLOWER_BANDS[1])
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Owner-scoped creator dashboard (resolved from the session, never a code).
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [copied, setCopied] = useState(false)

  /** The tracked share URL for a code. /a/<code> is the ONLY entry point that
   *  drops the attribution cookie, so this is what a creator must share. */
  const shareUrlFor = (code: string) => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL ?? ''
    return `${origin}/a/${code}`
  }

  const copyShareUrl = async (code: string) => {
    try {
      await navigator.clipboard.writeText(shareUrlFor(code))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is permission-gated; the URL is on screen either way, so the
      // honest fallback is to say the copy did not happen.
      setStatsError('Copying is blocked in this browser - select the link above instead.')
    }
  }

  const togglePlatform = (p: string) => {
    setPlatform((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }

  const scrollToJoin = () => {
    requestAnimationFrame(() => {
      document.getElementById('join')?.scrollIntoView({
        behavior: prefersReduced ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !handle.trim() || !email.trim()) {
      setFormError('Please add your name, handle and email so we can set up your code.')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/affiliate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          handle: handle.replace(/^@+/, '').trim(),
          // The model stores a single platform string; send the chips joined.
          platform: platform.length ? platform.join(', ') : undefined,
          followerBand: followers,
          email: email.trim(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setFormError(body?.error || 'Something went wrong. Please try again.')
        return
      }
      setSubmitted(true)
      scrollToJoin()
    } catch {
      setFormError('Network error - please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const startOver = () => {
    setSubmitted(false)
    setName('')
    setHandle('')
    setPlatform(['Instagram'])
    setFollowers(FOLLOWER_BANDS[1])
    setEmail('')
    setFormError('')
    scrollToJoin()
  }

  const checkStats = async () => {
    setStatsError('')
    setStatsLoading(true)
    setStats(null)
    try {
      const res = await fetch('/api/affiliate/me', {
        cache: 'no-store',
      })
      if (res.status === 401) {
        window.location.href = '/login?next=/affiliate'
        return
      }
      if (res.status === 404) {
        setStatsError(
          'Your code is not live yet. We email it the moment your application is approved.',
        )
        return
      }
      if (!res.ok) {
        setStatsError('Something went wrong. Please try again.')
        return
      }
      setStats((await res.json()) as StatsResult)
    } catch {
      setStatsError('Network error - please try again.')
    } finally {
      setStatsLoading(false)
    }
  }

  return (
    <main className="affiliate">
      {/* ============================ HERO ============================ */}
      <header className="af-hero">
        <div className="af-hero-ambient" aria-hidden="true" />
        <div className="wrap af-hero-grid">
          <div className="af-hero-copy">
            <span className="eyebrow">Creator Program</span>
            <h1 className="display af-hero-title">
              Share what you love. Earn on every pack.
            </h1>
            <p className="af-hero-sub">
              Apply in a minute for a personal Femi9 code. Your followers get{' '}
              <strong>10% off</strong> their first order, and you earn{' '}
              <strong>commission</strong> on everything they buy - paid every
              month, straight to your UPI.
            </p>
            <div className="af-hero-cta">
              <a href="#join" className="btn btn-primary">
                Apply now {Ico.arrow}
              </a>
              <a href="#how" className="btn btn-ghost">
                See how it works
              </a>
            </div>
            <div className="af-hero-trust">
              <div className="af-avatars" aria-hidden="true">
                <span>A</span>
                <span>M</span>
                <span>R</span>
                <span>K</span>
              </div>
              <p>
                Trusted by <strong>400+</strong> Indian creators &amp; care
                communities.
              </p>
            </div>
          </div>

          {/* tangible reward preview — no image, pure layout */}
          <aside className="af-preview" aria-label="Example creator dashboard">
            <div className="af-preview-top">
              <div className="af-preview-who">
                <span className="af-preview-avatar">M</span>
                <div>
                  <b>Meher Kapoor</b>
                  <span>@meher.styles · Instagram</span>
                </div>
              </div>
              <span className="af-preview-live">Live</span>
            </div>

            <div className="af-preview-code">
              <span className="af-preview-label">Your code</span>
              <strong className="display">MEHER15</strong>
              <span className="af-preview-off">10% off for followers</span>
            </div>

            <div className="af-preview-stats">
              <div>
                <b>1,284</b>
                <span>Clicks</span>
              </div>
              <div>
                <b>128</b>
                <span>Orders</span>
              </div>
              <div>
                <b>Rs. 4,200</b>
                <span>This month</span>
              </div>
            </div>
            <p className="af-preview-note">Sample - yours starts at zero.</p>
          </aside>
        </div>
      </header>

      {/* ======================= HOW IT WORKS ======================= */}
      <section className="section af-how" id="how">
        <div className="wrap">
          <Rise className="af-head">
            <h2 className="display">Three steps to your first payout</h2>
            <p>
              No inventory, no invoices. Apply today; once you&rsquo;re approved
              your code is live and you can start sharing.
            </p>
          </Rise>

          <ol className="af-steps">
            {[
              {
                n: '01',
                t: 'Apply & get approved',
                d: 'Tell us where you post. We review new creators within a day or two and email your unique promo code.',
              },
              {
                n: '02',
                t: 'Share it anywhere',
                d: 'Drop it in your bio, stories or videos. Anyone who uses it gets 10% off their first Femi9 order.',
              },
              {
                n: '03',
                t: 'Earn on every order',
                    d: 'You keep commission on everything they buy - tracked live and paid monthly via UPI.',
              },
            ].map((s, i) => (
              <Rise as="li" key={s.n} delay={i * 90} className="af-step">
                <span className="af-step-num display">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </Rise>
            ))}
          </ol>
        </div>
      </section>

      {/* ===================== PERKS + TIERS BAND ==================== */}
      <section className="section af-perks-section">
        <div className="wrap">
          <Rise>
            <div className="af-perks">
              <div className="af-perks-head">
                <h2 className="display">Made worth your while</h2>
                <p>
                  Real rewards for you and a genuine saving for the people who
                  trust you.
                </p>
              </div>

              <div className="af-perks-grid">
                {[
                  {
                    icon: Ico.tag,
                    t: '10% off for followers',
                    d: 'A discount they actually feel, on their first pack.',
                  },
                  {
                    icon: Ico.coin,
                    t: 'Commission for you',
                    d: 'On every order placed with your code - no cap.',
                  },
                  {
                    icon: Ico.calendar,
                    t: 'Monthly UPI payouts',
                    d: 'Paid on the 1st, no minimum threshold to start.',
                  },
                  {
                    icon: Ico.gift,
                    t: 'Free product drops',
                    d: 'First dibs on new launches and creator-only boxes.',
                  },
                ].map((p) => (
                  <div className="af-perk" key={p.t}>
                    <span className="af-perk-icon">{p.icon}</span>
                    <b>{p.t}</b>
                    <p>{p.d}</p>
                  </div>
                ))}
              </div>

              <div className="af-tiers">
                <span className="af-tiers-label">
                  Your rate grows as you do
                </span>
                <div className="af-tiers-row">
                  {[
                    { t: 'Rising', r: '15%', d: '0–25 orders / month' },
                    { t: 'Established', r: '18%', d: '25–75 orders / month' },
                    { t: 'Top creator', r: '22%', d: '75+ orders / month' },
                  ].map((tier) => (
                    <div className="af-tier" key={tier.t}>
                      <span className="af-tier-name">{tier.t}</span>
                      <b className="display">{tier.r}</b>
                      <span className="af-tier-sub">{tier.d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Rise>
        </div>
      </section>

      {/* =================== FORM / SUCCESS ========================= */}
      <section className="section af-join" id="join">
        <div className="wrap af-join-grid">
          <Rise className="af-join-intro">
            <span className="af-kicker">Join the program</span>
            <h2 className="display">Apply for your code.</h2>
            <p>
              Free to join, no minimum following, and you can step away any time.
              We only need the basics to review your application and set up your
              code.
            </p>
            <ul className="af-reassure">
                    <li>{Ico.check} Free forever - no fees, no lock-in</li>
              <li>{Ico.check} No minimum follower count</li>
              <li>{Ico.check} Track clicks &amp; earnings any time</li>
            </ul>

            {/* Your creator dashboard. There used to be a "enter your code"
                input here, but /api/affiliate/me resolves stats from the SESSION
                and ignored the code entirely — so typing any non-empty string
                returned your own numbers under someone else's label. */}
            <div style={{ marginTop: 30, paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}>
              <span className="af-kicker" style={{ marginBottom: 10 }}>
                Your creator dashboard
              </span>
              <p style={{ marginTop: 0, marginBottom: 14, maxWidth: '34ch' }}>
                Signed in as an approved creator? See your live clicks, orders and
                earnings, and copy your share link.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={checkStats}
                disabled={statsLoading}
                style={{ minHeight: 48 }}
              >
                {statsLoading ? 'Loading…' : 'View my stats'}
              </button>

              {statsError && (
                <p className="af-error" role="alert" style={{ marginTop: 12 }}>
                  {statsError}
                </p>
              )}

              {stats && (
                <div style={{ marginTop: 18 }}>
                  <div className="af-stats">
                    <div className="af-stat">
                      <b>{num(stats.clicks)}</b>
                      <span>Clicks</span>
                    </div>
                    <div className="af-stat">
                      <b>{num(stats.orders)}</b>
                      <span>Orders</span>
                    </div>
                    <div className="af-stat">
                      <b>{inr(stats.earnings)}</b>
                      <span>Earnings</span>
                    </div>
                  </div>
                  <p style={{ marginTop: 12, fontSize: '0.88rem', color: 'var(--muted)' }}>
                    Code <strong style={{ color: 'var(--navy)', letterSpacing: '0.04em' }}>{stats.promoCode}</strong>{' '}
                    · {statusLabel(stats.status)}
                  </p>
                  {/* THE share link. Clicks and commission are only tracked for
                      visitors who arrive through /a/<code>, so a creator who
                      never sees this URL can never earn anything. */}
                  <div className="af-share">
                    <code className="af-share-url">{shareUrlFor(stats.promoCode)}</code>
                    <button
                      type="button"
                      className="btn btn-ghost af-share-copy"
                      onClick={() => copyShareUrl(stats.promoCode)}
                    >
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Rise>

          <Rise delay={90} className="af-join-panel">
            {submitted ? (
              /* ---------------------- SUCCESS ----------------------- */
              <div className="af-dash">
                <div className="af-dash-hero">
                  <span className="af-dash-badge">Application received</span>
                  <h3 className="display">Thanks, {name.split(' ')[0] || 'creator'}.</h3>
                  <p>
                    We&rsquo;ve got your application. Our team reviews new
                    creators within a day or two - we&rsquo;ll email your personal
                    Femi9 code the moment you&rsquo;re approved.
                  </p>
                </div>

                <p className="af-payout-note">
                  {Ico.calendar}
                  Once approved, your code goes live instantly. Share it anywhere
                  and your clicks, orders and earnings start tracking right away.
                </p>

                <button type="button" className="af-startover" onClick={startOver}>
                  Submit another application
                </button>
              </div>
            ) : (
              /* ------------------ APPLICATION FORM ------------------ */
              <form className="af-form" onSubmit={handleSubmit} noValidate>
                <div className="af-field">
                  <label htmlFor="af-name">Full name</label>
                  <input
                    id="af-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Aisha Verma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="af-field">
                  <label htmlFor="af-handle">Social handle</label>
                  {/* A social handle is never a sentence: without these three,
                      mobile keyboards capitalise and autocorrect it. */}
                  <div className="af-handle">
                    <span aria-hidden="true">@</span>
                    <input
                      id="af-handle"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="aisha.reads"
                      value={handle.replace(/^@+/, '')}
                      onChange={(e) =>
                        setHandle(e.target.value.replace(/^@+/, ''))
                      }
                    />
                  </div>
                </div>

                <fieldset className="af-field af-fieldset">
                  <legend>Where do you post?</legend>
                  <div className="af-chips">
                    {PLATFORMS.map((p) => {
                      const on = platform.includes(p)
                      return (
                        <button
                          type="button"
                          key={p}
                          className={`af-chip${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          onClick={() => togglePlatform(p)}
                        >
                          {p}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <div className="af-field">
                  <label htmlFor="af-followers">Followers</label>
                  <div className="af-select">
                    <select
                      id="af-followers"
                      value={followers}
                      onChange={(e) => setFollowers(e.target.value)}
                    >
                      {FOLLOWER_BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <span className="af-select-arrow" aria-hidden="true" />
                  </div>
                </div>

                <div className="af-field">
                  <label htmlFor="af-email">Email</label>
                  <input
                    id="af-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {formError && (
                  <p className="af-error" role="alert">
                    {formError}
                  </p>
                )}

                <button type="submit" className="btn btn-primary af-submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Apply for my code'}
                </button>
                <p className="af-form-fine">
                  By applying you agree to share honestly. No spam - we promise.
                </p>
              </form>
            )}
          </Rise>
        </div>
      </section>

      {/* ============================= FAQ ========================== */}
      <section className="section af-faq-section">
        <div className="wrap af-faq-grid">
          <Rise className="af-faq-intro">
            <h2 className="display">Questions, answered</h2>
            <p>
              Everything creators ask before they sign up. Still unsure? Write to{' '}
              <strong>creators@femi9.in</strong>.
            </p>
          </Rise>

          <Rise delay={90} className="af-faq-list">
            {[
              {
                q: 'When do I get paid?',
                a: 'Earnings are tallied through the month and paid on the 1st via UPI. There is no minimum threshold to receive your first payout - even a single order counts.',
              },
              {
                q: 'Can I use the code myself?',
                a: 'Yes. Your code works on your own orders too, so you get the 10% follower discount whenever you restock - though commission is earned on your community’s orders.',
              },
              {
                q: 'Is there a minimum following?',
                a: 'None at all. Whether you have 500 engaged readers or 500k, you get the same code and the same starting rate. Your commission grows with orders, not follower count.',
              },
              {
                q: 'How is this different from a brand collab?',
                a: 'Collaborations and partnerships are separate, hands-on programs. This is self-serve: once approved your code is always live, always yours, and earns commission automatically - no briefs or deadlines.',
              },
            ].map((f) => (
              <details className="af-faq" key={f.q}>
                <summary>
                  <span>{f.q}</span>
                  <span className="af-faq-mark" aria-hidden="true" />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </Rise>
        </div>
      </section>
    </main>
  )
}

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import '../styles/partner.css'

type FormState = {
  name: string
  phone: string
  city: string
  reason: string
  situation: string
}

const SITUATIONS = ['Homemaker', 'Student', 'Working', 'Running a small shop']

const STATS = [
  { n: '5,000+', l: 'women entrepreneurs' },
  { n: '12', l: 'districts across Tamil Nadu' },
  { n: 'Rs.8,000–20,000', l: 'average monthly earning' },
  { n: '100%', l: 'flexible hours' },
]

const STEPS = [
  {
    n: '01',
    t: 'Apply',
    d: 'Fill the short form below. It takes about two minutes - no paperwork.',
  },
  {
    n: '02',
    t: 'Get onboarded',
    d: 'Meet your local team, collect a starter kit and simple, friendly training.',
  },
  {
    n: '03',
    t: 'Sell in your community',
    d: 'On WhatsApp, at your doorstep, or through nearby shops - however suits you.',
  },
  {
    n: '04',
    t: 'Earn & grow',
    d: 'Make money on every pack and build a loyal base of customers who reorder.',
  },
]

// small, plain stroke icons — a simple shape per benefit
function IconCoin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.4 9.4c-.6-.7-1.5-1-2.4-1-1.5 0-2.6.8-2.6 2s1.1 1.6 2.6 1.9c1.5.3 2.6.8 2.6 2s-1.1 2-2.6 2c-1 0-1.9-.4-2.5-1.1" strokeLinecap="round" />
    </svg>
  )
}
function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 11 12 4l8 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9h12v-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19v-5h4v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 3.5 5 6.2v5c0 4.3 2.9 7.3 7 9.3 4.1-2 7-5 7-9.3v-5L12 3.5Z" strokeLinejoin="round" />
      <path d="M9.2 12.2 11.2 14l3.6-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconSupport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5.5 20c.6-3.4 3.2-5.4 6.5-5.4S17.9 16.6 18.5 20" strokeLinecap="round" />
    </svg>
  )
}
function IconSprout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 20v-7" strokeLinecap="round" />
      <path d="M12 13c0-3-2.2-5-5-5 0 3 2.2 5 5 5Z" strokeLinejoin="round" />
      <path d="M12 12c0-3.4 2.3-5.6 5.4-5.6C17.4 9.8 15.1 12 12 12Z" strokeLinejoin="round" />
    </svg>
  )
}

function IconCommunity() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="7.6" r="2.6" />
      <path d="M7.4 18.5c.4-2.9 2.3-4.6 4.6-4.6s4.2 1.7 4.6 4.6" strokeLinecap="round" />
      <circle cx="5.6" cy="10" r="2" />
      <path d="M2.5 18c.3-2.1 1.5-3.3 3.1-3.4" strokeLinecap="round" />
      <circle cx="18.4" cy="10" r="2" />
      <path d="M21.5 18c-.3-2.1-1.5-3.3-3.1-3.4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * `shape` places each benefit in the bento: `wide` tiles are dark, span two
 * columns and put the icon beside the copy; `square` tiles are purple and stack
 * it centred. The order here IS the layout — see `.pt-why-grid` in partner.css.
 */
const BENEFITS = [
  {
    icon: <IconCoin />,
    t: 'Flexible income',
    d: 'Earn on every pack you sell. The more you grow, the more you make.',
    shape: 'wide' as const,
  },
  {
    icon: <IconHome />,
    t: 'Work from home',
    d: 'Sell around your family and your day. No office, no boss, no commute.',
    shape: 'square' as const,
  },
  {
    icon: <IconShield />,
    t: 'A product women trust',
    d: 'Organic, doctor-formulated pads your neighbours reorder with confidence.',
    shape: 'square' as const,
  },
  {
    icon: <IconSupport />,
    t: 'Training & support',
    d: 'We guide you at every step, from your very first sale onward.',
    shape: 'wide' as const,
  },
  {
    icon: <IconSprout />,
    t: 'No big investment',
    d: 'Start small with a low-cost starter kit. No savings needed to begin.',
    shape: 'square' as const,
  },
]

const VOICES = [
  {
    q: 'I earn while my kids are at school, and my neighbours finally trust their pads.',
    name: 'Selvi',
    place: 'Erode',
  },
  {
    q: 'I started with one starter kit. Now thirty homes on my street buy only from me.',
    name: 'Kavitha',
    place: 'Namakkal',
  },
]

/**
 * Counts the number(s) inside a stat up from zero, once, when it comes into
 * view ("Rs.8,000–20,000" counts both ends). It always lands on exactly
 * `value`: the server renders the final string, an invisible copy reserves its
 * width so the card never jumps while digits grow, and screen readers only ever
 * get the final value. Reduced motion shows the final value straight away.
 */
function CountUp({ value, delay = 0, duration = 1800 }: { value: string; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [text, setText] = useState(value)

  useEffect(() => {
    const el = ref.current
    const parts = value.split(/(\d[\d,]*)/)
    if (!el || parts.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const targets = parts.map((p, i) => (i % 2 ? Number(p.replace(/,/g, '')) : 0))

    const render = (t: number) =>
      parts
        .map((p, i) => {
          if (i % 2 === 0) return p
          const n = Math.round(targets[i] * t)
          return p.includes(',') ? n.toLocaleString('en-US') : String(n)
        })
        .join('')

    let raf = 0
    let timer = 0
    setText(render(0))

    const run = () => {
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - p, 4)
        setText(p < 1 ? render(eased) : value)
        if (p < 1) raf = window.requestAnimationFrame(step)
      }
      raf = window.requestAnimationFrame(step)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        timer = window.setTimeout(run, delay)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
      window.cancelAnimationFrame(raf)
    }
  }, [value, delay, duration])

  return (
    <span className="pt-count" ref={ref}>
      <span className="pt-count-ghost" aria-hidden="true">{value}</span>
      <span className="pt-count-live" aria-hidden="true">{text}</span>
      <span className="pt-sr">{value}</span>
    </span>
  )
}

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ── How it works: pinned cards on a thread ─────────────────────────────── */

/** Per-card tilt and where the pin goes along the card's top edge. */
const PIN_TILTS = [-5, 4, -3, 5]
const PIN_X = ['62%', '38%', '60%', '42%']

/**
 * Pin geometry, in px, for the pin below (viewBox 64×72). PIN_W must match
 * `.pt-pin { width }` in partner.css. TIP is where the needle enters the card;
 * NECK is where the thread is tied, just under the head: the point (26, 34) of
 * the upright pin, turned 24° about the tip.
 */
const PIN_W = 58
const PIN_SCALE = PIN_W / 64
const PIN_TIP = { x: 26 * PIN_SCALE, y: 62 * PIN_SCALE }
const PIN_NECK = { x: 11.39 * PIN_SCALE, y: -25.58 * PIN_SCALE }

type Pt = { x: number; y: number }

/** A soft sagging thread through the pins, bowing away from each straight run. */
function threadPath(pts: Pt[]) {
  if (pts.length < 2) return ''
  const f = (n: number) => n.toFixed(1)
  let d = 'M' + f(pts[0].x) + ' ' + f(pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    // Unit normal; point it downward (gravity) unless the run is near-vertical,
    // in which case bow alternately left and right.
    let nx = -dy / len
    let ny = dx / len
    if (Math.abs(ny) > 0.35) {
      if (ny < 0) { nx = -nx; ny = -ny }
    } else if ((i % 2 === 0) !== (nx > 0)) {
      nx = -nx
      ny = -ny
    }
    // A gentle drape: enough to read as a hanging thread, shallow enough that on
    // desktop it stays near the card tops instead of dipping into the panels.
    const sag = Math.min(64, Math.max(22, len * 0.15))
    const c1x = a.x + dx * 0.3 + nx * sag
    const c1y = a.y + dy * 0.3 + ny * sag
    const c2x = b.x - dx * 0.3 + nx * sag
    const c2y = b.y - dy * 0.3 + ny * sag
    d += ' C' + f(c1x) + ' ' + f(c1y) + ' ' + f(c2x) + ' ' + f(c2y) + ' ' + f(b.x) + ' ' + f(b.y)
  }
  return d
}

/** A glossy 3D push-pin: domed cap, waisted body, steel needle and a cast shadow. */
function PushPin({ x, y, uid }: { x: number; y: number; uid: string }) {
  const id = (name: string) => uid + name
  const url = (name: string) => 'url(#' + id(name) + ')'
  return (
    <svg
      className="pt-pin"
      viewBox="0 0 64 72"
      aria-hidden="true"
      style={{ left: x - PIN_TIP.x, top: y - PIN_TIP.y }}
    >
      <defs>
        <linearGradient id={id('body')} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#2c1852" />
          <stop offset="0.32" stopColor="#9468e4" />
          <stop offset="0.55" stopColor="#6a42bd" />
          <stop offset="1" stopColor="#26154a" />
        </linearGradient>
        <radialGradient id={id('cap')} cx="0.36" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#d4bdff" />
          <stop offset="0.42" stopColor="#8759da" />
          <stop offset="1" stopColor="#40247a" />
        </radialGradient>
        <linearGradient id={id('metal')} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#5f6771" />
          <stop offset="0.45" stopColor="#f3f5f8" />
          <stop offset="1" stopColor="#737b85" />
        </linearGradient>
        <filter id={id('blur')} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* cast shadow on the card, falling to the lower right */}
      <ellipse cx="45" cy="57" rx="16" ry="4.4" transform="rotate(-26 45 57)" fill="rgba(18,8,36,0.42)" filter={url('blur')} />
      {/* contact shadow where the needle goes in */}
      <ellipse cx="26.5" cy="62" rx="2.8" ry="1.2" fill="rgba(18,8,36,0.6)" />

      <g transform="rotate(24 26 62)">
        <rect x="25.1" y="43" width="1.8" height="19" rx="0.9" fill={url('metal')} />
        <ellipse cx="26" cy="44.6" rx="10.6" ry="3.4" fill={url('body')} />
        <path d="M17.4 44.4 C19.6 39.4 21.2 35.4 21.6 29.6 L30.4 29.6 C30.8 35.4 32.4 39.4 34.6 44.4 Z" fill={url('body')} />
        <path d="M14 20 V26.4 A12 4.2 0 0 0 38 26.4 V20 Z" fill={url('body')} />
        <ellipse cx="26" cy="20" rx="12" ry="4.2" fill={url('cap')} />
        <ellipse cx="21.4" cy="18.8" rx="4.8" ry="1.4" fill="#ffffff" opacity="0.78" />
        <path d="M22.9 31 C22.6 36 21.7 39.6 20.4 43.2" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        <path d="M16.3 21.6 V25.8" stroke="#ffffff" strokeOpacity="0.38" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/**
 * The four steps as tilted cards pinned to a grid board and strung together by
 * one thread. The cards are plain CSS; this measures an anchor inside each
 * (after the tilt), then draws the thread and places the pins over the cards.
 * Re-measures on resize, font load and any entrance animation ending.
 */
function PinnedSteps() {
  const boardRef = useRef<HTMLDivElement>(null)
  const uid = 'ptpin' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [geo, setGeo] = useState<{ w: number; h: number; pins: Pt[] } | null>(null)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    let raf = 0
    const measure = () => {
      window.cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(() => {
        const b = board.getBoundingClientRect()
        const pins = [...board.querySelectorAll<HTMLElement>('.pt-pin-anchor')].map((a) => {
          const r = a.getBoundingClientRect()
          return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top }
        })
        setGeo({ w: b.width, h: b.height, pins })
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(board)
    window.addEventListener('resize', measure)
    board.addEventListener('transitionend', measure)
    board.addEventListener('animationend', measure)
    document.fonts?.ready.then(measure)
    return () => {
      window.cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', measure)
      board.removeEventListener('transitionend', measure)
      board.removeEventListener('animationend', measure)
    }
  }, [])

  return (
    <div className="pt-board" ref={boardRef}>
      <ol className="pt-steps pt-steps--pinned">
        {STEPS.map((s, i) => (
          <li
            className="pt-step pt-pin-card"
            key={s.n}
            style={{ '--tilt': PIN_TILTS[i] + 'deg', '--pin-x': PIN_X[i] } as CSSProperties}
          >
            <span className="pt-pin-anchor" aria-hidden="true" />
            <span className="pt-pin-paper" aria-hidden="true" />
            <span className="display pt-step-n">{s.n}</span>
            <h3 className="pt-step-t">{s.t}</h3>
            <p className="pt-step-d">{s.d}</p>
          </li>
        ))}
      </ol>

      {geo && (
        <>
          <svg
            className="pt-thread"
            width={geo.w}
            height={geo.h}
            viewBox={'0 0 ' + geo.w + ' ' + geo.h}
            aria-hidden="true"
          >
            <path d={threadPath(geo.pins.map((p) => ({ x: p.x + PIN_NECK.x, y: p.y + PIN_NECK.y })))} />
          </svg>
          {geo.pins.map((p, i) => (
            <PushPin key={i} x={p.x} y={p.y} uid={uid + 'p' + i} />
          ))}
        </>
      )}
    </div>
  )
}

export function Partner() {
  const [form, setForm] = useState<FormState>({
    name: '',
    phone: '',
    city: '',
    reason: '',
    situation: SITUATIONS[0],
  })
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({})
  // Holds just the applicant's name once the lead is accepted — enough to
  // personalise the success panel without keeping the whole submission around.
  const [saved, setSaved] = useState<{ name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const update = (key: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const onPhone = (value: string) =>
    update('phone', value.replace(/\D/g, '').slice(0, 10))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = form.name.trim()
    const phone = form.phone.trim()
    const next: { name?: string; phone?: string } = {}
    if (!name) next.name = 'Please tell us your name.'
    if (phone.length !== 10) next.phone = 'Enter your 10-digit mobile number.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    // Persist the lead to the CRM pipeline (was a localStorage stub before) so
    // the sales team can follow up — the whole point of the form.
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/partner/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          city: form.city.trim(),
          situation: form.situation,
          reason: form.reason.trim(),
        }),
      })
      if (!res.ok) throw new Error()
      setSaved({ name })
    } catch {
      // Keep the form intact so the visitor can simply retry.
      setSubmitError('Something went wrong sending your application. Please try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="partner">
      {/* ── 1 · HERO ───────────────────────────────────────────── */}
      <section className="pt-hero">
        <div className="pt-hero-glow" aria-hidden="true" />
        <div className="wrap pt-hero-grid">
          <div className="pt-hero-inner">
            <span className="eyebrow">Opportunities</span>
            <h1 className="display pt-hero-title">
              Turn better periods into your livelihood.
            </h1>
            <p className="pt-hero-sub">
              Join 5,000+ women across Tamil Nadu earning a real income by bringing
              trusted, organic period care to the people they already know.
            </p>
            <div className="pt-hero-cta">
              <button type="button" className="btn btn-primary" onClick={() => scrollToId('apply')}>
                Apply to become a partner
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => scrollToId('how')}>
                How it works
              </button>
            </div>
            <p className="pt-hero-note">
              No investment to start · Work on your own hours · We call you on WhatsApp
            </p>
          </div>

          {/* ── 2 · STATS (right column; the figures count up once) ─── */}
          <ul className="pt-hero-stats" aria-label="Femi9 partners in numbers">
            {STATS.map((s, i) => (
              <li className="pt-stat" key={s.l} style={{ '--i': i } as CSSProperties}>
                <div className="display pt-stat-n">
                  <CountUp value={s.n} delay={500 + i * 140} />
                </div>
                <div className="pt-stat-l">{s.l}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 3 · HOW IT WORKS ───────────────────────────────────── */}
      <section id="how" className="section wrap pt-how">
        <header className="pt-head">
          <h2 className="display">How it works</h2>
          <p>Four simple steps from your first hello to your first earning.</p>
        </header>
        <PinnedSteps />
      </section>

      {/* ── 4 · WHY PARTNER (bento) ────────────────────────────── */}
      <section className="section wrap pt-why">
        <header className="pt-head pt-why-head">
          <h2 className="display">
            Why <span className="pt-why-accent">partner</span> with <span className="pt-why-accent">Femi9</span>
          </h2>
          <p>Dignified work that fits your life - and grows a business that is yours.</p>
        </header>
        <div className="pt-why-grid">
          <article className="pt-feature">
            <span className="pt-feature-ic"><IconCommunity /></span>
            <h3 className="display pt-feature-t">Be part of a movement</h3>
            <p className="pt-feature-d">
              Every pack you sell puts health, dignity and income into the hands of
              women across Tamil Nadu - starting with your own.
            </p>
            <p className="pt-feature-tag">5,000+ women already lead the way</p>
          </article>
          {BENEFITS.map((b) => (
            <article className={`pt-benefit pt-benefit--${b.shape}`} key={b.t}>
              <span className="pt-benefit-ic">{b.icon}</span>
              <div className="pt-benefit-body">
                <h3 className="pt-benefit-t">{b.t}</h3>
                <p className="pt-benefit-d">{b.d}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── 5 · VOICES (plum panel) ────────────────────────────── */}
      <section className="section wrap">
        <div className="pt-voices">
          <div className="pt-voices-head">
            <span className="pt-voices-eyebrow">In their words</span>
            <h2 className="display pt-voices-title">Partners who lead in their streets.</h2>
          </div>
          <div className="pt-voices-grid">
            {VOICES.map((v) => (
              <figure className="pt-voice" key={v.name}>
                <blockquote>{v.q}</blockquote>
                <figcaption>
                  <span className="pt-voice-name">{v.name}</span>
                  <span className="pt-voice-place">{v.place}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6 · APPLICATION FORM ───────────────────────────────── */}
      <section id="apply" className="section wrap pt-apply">
        <div className="pt-apply-grid">
          <div className="pt-apply-intro">
            <h2 className="display">Apply to become a partner</h2>
            <p>
              Tell us a little about yourself. There is no cost to apply and no
              obligation - our team will call you on WhatsApp to talk it through.
            </p>
            <ul className="pt-apply-list">
              <li>A friendly local team, in your own language</li>
              <li>A starter kit and hands-on training</li>
              <li>Earn from your very first pack</li>
            </ul>
          </div>

          {saved ? (
            <div className="pt-success" role="status" aria-live="polite">
              <span className="pt-success-ic" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m5 12.5 4.2 4.2L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h3 className="display">Application received</h3>
              <p>
                Thank you, {saved.name}. Our team will reach out on WhatsApp within
                2 working days.
              </p>
              <p className="pt-success-sub">
                Keep your phone handy - we&apos;ll call you on WhatsApp to talk it
                through. Welcome to the Femi9 family.
              </p>
            </div>
          ) : (
            <form className="pt-form" onSubmit={onSubmit} noValidate>
              <div className="pt-field">
                <label htmlFor="pt-name">Full name</label>
                <input
                  id="pt-name"
                  type="text"
                  autoComplete="name"
                  placeholder="e.g. Lakshmi Priya"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  aria-invalid={!!errors.name}
                />
                {errors.name && <span className="pt-err">{errors.name}</span>}
              </div>

              <div className="pt-field">
                <label htmlFor="pt-phone">Phone number</label>
                <div className="pt-phone">
                  <span className="pt-phone-cc">+91</span>
                  <input
                    id="pt-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="10-digit mobile number"
                    value={form.phone}
                    onChange={(e) => onPhone(e.target.value)}
                    aria-invalid={!!errors.phone}
                  />
                </div>
                {errors.phone && <span className="pt-err">{errors.phone}</span>}
              </div>

              <div className="pt-field">
                <label htmlFor="pt-city">City / district</label>
                <input
                  id="pt-city"
                  type="text"
                  autoComplete="address-level2"
                  placeholder="e.g. Coimbatore"
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                />
              </div>

              <div className="pt-field">
                <label htmlFor="pt-situation">Your current situation</label>
                <select
                  id="pt-situation"
                  value={form.situation}
                  onChange={(e) => update('situation', e.target.value)}
                >
                  {SITUATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-field pt-field--full">
                <label htmlFor="pt-reason">Why do you want to partner?</label>
                <textarea
                  id="pt-reason"
                  rows={3}
                  placeholder="A line or two about what brings you here - no wrong answers."
                  value={form.reason}
                  onChange={(e) => update('reason', e.target.value)}
                />
              </div>

              {submitError && (
                <div className="pt-field pt-field--full">
                  <span className="pt-err" role="alert">{submitError}</span>
                </div>
              )}

              <div className="pt-form-foot">
                <button type="submit" className="btn btn-primary pt-submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit application'}
                </button>
                <span className="pt-form-note">We reply on WhatsApp within 2 working days.</span>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── 7 · CLOSING ────────────────────────────────────────── */}
      <section className="wrap pt-close">
        <p className="display">
          Whether you sell to five homes or five hundred, you belong here. Femi9
          grows because women like you choose to lead.
        </p>
      </section>
    </main>
  )
}

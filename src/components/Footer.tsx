'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from '@/lib/router-compat'
import { useCart } from '../store/cart'
import { usePublicSettings } from '@/lib/use-public-settings'
import { useMediaGate } from './useMediaGate'
import { Instagram, Facebook, Youtube, Linkedin, Whatsapp } from './Icons'

const IG = 'https://www.instagram.com/femi9official/'

const SOCIALS = [
  { href: IG, label: 'Instagram', Icon: Instagram },
  { href: 'https://www.facebook.com/femi9official/', label: 'Facebook', Icon: Facebook },
  { href: 'https://www.youtube.com/@femi9official', label: 'YouTube', Icon: Youtube },
  { href: 'https://www.linkedin.com/company/femi9-official/', label: 'LinkedIn', Icon: Linkedin },
]

/** Deliberately empty. Until /api/settings resolves we render a single "Browse
 *  all products" link rather than guessing slugs — a guessed slug that has been
 *  archived or renamed is a 404 in the footer of every page on the site, which
 *  is exactly the bug this column used to have. */
const FALLBACK_SHOP: { slug: string; name: string }[] = []

export function Footer() {
  const { notify } = useCart()
  const { whatsappNumber, tharaEnabled, shopLinks } = usePublicSettings()
  const wa = `https://wa.me/${whatsappNumber}`
  const [email, setEmail] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const socials = [...SOCIALS, { href: `https://wa.me/${whatsappNumber}`, label: 'WhatsApp', Icon: Whatsapp }]
  // The watermark is a 2544x888 SVG stretched to min-width:800px at 120% of the
  // footer height and then run through brightness(0) invert(1) at 8% opacity —
  // on a 360px screen that is an unrecognisable smear that repaints on every
  // scroll frame. Gated out of the JSX rather than `display:none`d, because
  // display:none does not cancel a download.
  const showWatermark = useMediaGate('(min-width: 561px)')
  const shop = shopLinks.length > 0 ? shopLinks : FALLBACK_SHOP

  /**
   * Real subscription. This used to clear the input and toast "Thanks! You are
   * on the list" without sending the address anywhere — the shopper was told
   * she had subscribed while her email was discarded. The confirmation now only
   * appears on a 2xx, and a failure says so inline instead of lying quietly.
   */
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const value = email.trim()
    setError(null)
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Please enter a valid email address.')
      return
    }

    setSubscribing(true)
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source: 'footer' }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; alreadySubscribed?: boolean }
      if (!res.ok) {
        setError(data.error ?? 'We could not sign you up just now. Please try again.')
        return
      }
      setEmail('')
      notify(data.alreadySubscribed ? 'You are already on the list' : 'Thanks! You are on the list')
    } catch {
      setError('We could not reach the server. Please check your connection.')
    } finally {
      setSubscribing(false)
    }
  }

  /**
   * One-time entrance for the tape across the footer's top seam (craft-footer.css
   * §2c). The edge is only marked "pending" when the footer starts below the
   * fold, so a footer already on screen - and any visitor without JS or with
   * reduced motion - just sees the tape in place. It is laid across the first
   * time the footer scrolls into view and never replays.
   */
  const edgeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const edge = edgeRef.current
    if (!edge || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (edge.getBoundingClientRect().top < window.innerHeight) return

    edge.dataset.edge = 'pending'
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        edge.dataset.edge = 'in'
        observer.disconnect()
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    // Watch the whole footer, not the thin edge strip: on a phone the footer is
    // taller than the screen, and a jump to the bottom (an anchor, End, a fast
    // fling) can carry the strip past the top without it ever intersecting -
    // which would leave the edge stuck in its pending shape.
    observer.observe(edge.parentElement ?? edge)
    return () => observer.disconnect()
  }, [])

  return (
    <footer className="footer">
      {/* The taped seam: a thin band of page colour across the top, and a strip
          of translucent lilac tape laid over the line where it meets the plum
          panel. Decorative only, clipped by the footer's own overflow, and clear
          of the content below the top padding (craft-footer.css §2). */}
      <div ref={edgeRef} className="footer-topcurve" aria-hidden="true" />

      {/* Background watermark: script wordmark & female silhouette.
          Decorative only. Intrinsic size stated so the browser can reserve the
          box instead of reflowing the footer once the SVG parses, and lazy +
          async so a below-the-fold decoration stops competing with
          above-the-fold content on a phone. */}
      {showWatermark && (
        <div className="footer-watermark" aria-hidden="true">
          <img
            className="footer-watermark-img"
            src="/assets/img/logo-mark.svg"
            alt=""
            width="2544"
            height="888"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}

      <div className="wrap footer-in">
        <div className="footer-main">
          {/* Column 1: Brand Block */}
          <div className="footer-brand">
            <Link to="/" aria-label="Femi9 Home">
              {/* 5KB — below the threshold the derivative pipeline bothers
                  with, so it stays a plain <img>. It renders at height:44px
                  with width:auto, which is a real CLS source until the PNG
                  decodes; the intrinsic 212x74 gives the browser the ratio up
                  front. */}
              <img
                className="footer-logo-white"
                src="/assets/figma-home/footer-imgImage1.png"
                alt="Femi9"
                width="212"
                height="74"
                loading="lazy"
                decoding="async"
              />
            </Link>
            <p className="footer-tagline">Thoughtfully designed period care for comfort, confidence, and everyday movement.</p>
            <p className="footer-desc">
              Organic, breathable period care that is kinder to your body and the planet.
            </p>

            <div className="footer-newsletter">
              <p className="nl-label">CARE IN YOUR INBOX</p>
              <form className="nl-form" onSubmit={onSubmit} noValidate>
                <input
                  id="footer-newsletter-email"
                  type="email"
                  // The mobile keyboard only offers the @ / .com row when the
                  // field asks for it, and iOS auto-capitalises the first
                  // character of a plain text field — which fails our own
                  // regex on the very first attempt for anyone who does not
                  // notice.
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  placeholder="Your email address"
                  aria-label="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'footer-newsletter-error' : undefined}
                  disabled={subscribing}
                />
                <button type="submit" className="nl-submit" disabled={subscribing}>
                  {subscribing ? 'SENDING…' : 'SUBSCRIBE'}
                </button>
              </form>
              {error && (
                <p id="footer-newsletter-error" role="alert" className="nl-error">
                  {error}
                </p>
              )}
            </div>

            <div className="footer-social">
              {socials.map(({ href, label, Icon }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                  <Icon />
                </a>
              ))}
            </div>
          </div>

          {/* Column 2: SHOP — resolved from the live catalog. Three slugs used to
              be hardcoded here, so archiving or renaming any of them turned a
              footer link on every page of the site into a 404 with no warning. */}
          <div className="footer-col">
            <h4>Shop</h4>
            {shop.length > 0 ? (
              shop.map((p) => (
                <Link key={p.slug} to={`/product/${p.slug}`}>
                  {p.name}
                </Link>
              ))
            ) : (
              <Link to="/shop">Browse the shop</Link>
            )}
          </div>

          {/* Column 3: FEMI9 */}
          <div className="footer-col">
            <h4>FEMI9</h4>
            <Link to="/#why">Why Femi9</Link>
            <Link to="/about">Our Story</Link>
            <Link to="/#opportunities">Impact</Link>
            <Link to="/dashboard">My dashboard</Link>
            {/* Only shown when the programme is actually switched on — nothing
                anywhere in the product linked to /thara before this. */}
            {tharaEnabled && <Link to="/thara">Thara programme</Link>}
          </div>

          {/* Column 4: SUPPORT */}
          <div className="footer-col">
            <h4>SUPPORT</h4>
            <a href={wa} target="_blank" rel="noopener noreferrer">
              Phone: +91 90429 16499
            </a>
            <a href="mailto:support@femi9.in">
              Email: support@femi9.in
            </a>
            <a href={wa} target="_blank" rel="noopener noreferrer">
              Contact us via WhatsApp
            </a>
            <a href={IG} target="_blank" rel="noopener noreferrer">
              @femi9official
            </a>
            <p className="footer-addr">222/1, Pavizham Nagar, Thindal, Erode, Tamil Nadu 638012</p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="footer-bottom">
          <span>&copy; Femi9 2026. All rights reserved.</span>
          <Link to="/privacy">Privacy Policy</Link>
        </div>
      </div>
    </footer>
  )
}

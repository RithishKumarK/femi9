import { useEffect, useState } from 'react'
import { Link, useRouter } from '@/lib/router-compat'
import { useCart } from '../store/cart'
import { usePublicSettings } from '@/lib/use-public-settings'
import { useLenis } from '@/immersive/SmoothScroll'
import { stickyNavHeight } from '@/lib/sticky-nav'
import { Bag, Menu } from './Icons'
import { IUser } from './AppIcons'
import { OptImg } from './OptImg'

const LINKS = [
  { to: '/shop', label: 'Shop' },
  { to: '/#why', label: 'Why Femi9' },
  { to: '/about', label: 'About Us' },
  { to: '/blog', label: 'Journal' },
  { to: '/partner', label: 'Opportunities' },
]

// secondary links — shown in the mobile menu + footer, not the desktop bar
const MORE = [
  { to: '/periods-wall', label: 'Periods Wall' },
  { to: '/affiliate', label: 'Affiliate' },
]

export function Nav() {
  const { count, openCart } = useCart()
  const router = useRouter()
  const lenis = useLenis()
  const { tharaEnabled } = usePublicSettings()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  // Client-resolved auth state. null = signed out / unknown (the safe default),
  // so a failed/slow /api/auth/me leaves the account entry pointing at /login.
  const [user, setUser] = useState<{ firstName?: string } | null>(null)

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 12)
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Reflect the session in the nav. The httpOnly cookie is invisible to JS, so we
  // ask the server who we are. Same-origin fetch sends the cookie by default.
  useEffect(() => {
    let active = true
    fetch('/api/auth/me')
      // A signed-out request may answer 401 — treat any non-OK as "no user".
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return
        // Tolerate the likely envelopes: { user: {...} }, { user: null }, or the
        // bare session object (identified by its `sub` claim).
        const u = data.user ?? (typeof data.sub === 'string' ? data : null)
        if (!u) return
        const name = typeof u.name === 'string' ? u.name.trim() : ''
        setUser({ firstName: name ? name.split(/\s+/)[0] : undefined })
      })
      .catch(() => {
        // Network/parse failure: stay signed-out so the icon links to /login.
      })
    return () => {
      active = false
    }
  }, [])

  // Escape closes the menu. `aria-expanded` on the burger advertises a
  // disclosure widget, and a disclosure a keyboard cannot dismiss is a worse
  // trap than no disclosure at all — on a phone with a paired keyboard there
  // was no way out except tapping the burger again.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const handleLinkClick = (to: string) => {
    setMenuOpen(false)
    if (to.startsWith('/#')) {
      const hash = to.substring(1)
      const el = document.querySelector(hash)
      if (el) {
        // `scrollIntoView` puts the target flush with the viewport top, i.e.
        // underneath the sticky bar, and the old ScrollManager offset of -70
        // undershot the 76px bar by 6px and could not see the safe-area inset.
        // Measure instead.
        const navH = stickyNavHeight()
        // The open menu is part of the header's flow box, so every target below
        // it is currently sitting ~580px lower than it will be once the menu
        // finishes collapsing. Take that back out or the page lands well short.
        const menuH = document.getElementById('mobile-menu')?.offsetHeight ?? 0
        // Go through Lenis where it is running, or it fights the native scroll
        // and snaps back. Lenis is deliberately absent on coarse pointers.
        if (lenis) {
          lenis.scrollTo(el as HTMLElement, { offset: -(navH + 8) - menuH })
        } else {
          const top =
            el.getBoundingClientRect().top + window.scrollY - menuH - navH - 8
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
      }
    }
  }

  // Signed-in shoppers go to their DASHBOARD; everyone else to sign-in.
  //
  // This used to point at /account, which is now the same screen twice over:
  // /dashboard carries the orders, subscriptions, addresses, profile and
  // rewards that /account carries, plus the cycle tracker. Sending the profile
  // control to /account meant the member landed on the duplicate. /account is
  // still there and still owns the write sheets — the edit-address and
  // edit-profile flows the dashboard links out to — it is just no longer the
  // front door.
  const accountHref = user ? '/dashboard' : '/login'

  // /thara is a full working dashboard that NOTHING in the product linked to —
  // a customer could only reach it by typing the URL. Shown only when the
  // programme is switched on for this deployment.
  const secondary = tharaEnabled ? [...MORE, { to: '/thara', label: 'Thara' }] : MORE

  /**
   * Sign out. /api/auth/logout existed with zero callers anywhere in the
   * storefront: a signed-in customer had no way to end her session.
   *
   * refresh() after replace() matters — every member surface is server-rendered
   * from the cookie, so without it the next paint still shows her name.
   */
  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Even if the request failed, fall through: the safest visible outcome is
      // to send her home and let the server re-resolve the session.
    }
    setMenuOpen(false)
    setUser(null)
    router.replace('/')
    router.refresh()
  }

  return (
    <header className={`nav${scrolled ? ' scrolled' : ''}`} id="nav">
      <div className="wrap nav-in">
        <Link to="/" className="nav-logo" aria-label="Femi9 home">
          {/* .nav-logo crops this square source to a 116x48 window, so it renders
              116px wide. Preloaded in app/layout.tsx — keep the paths in step. */}
          <OptImg
            base="figma-home/navbar-imgImage29"
            sizes="116px"
            alt="Femi9"
            priority
          />
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => handleLinkClick(l.to)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="nav-right">
          <Link to={accountHref} className="cart-btn" aria-label={user ? 'My dashboard' : 'Sign in'}>
            <IUser />
          </Link>
          <button
            className="cart-btn"
            onClick={openCart}
            aria-label={count > 0 ? `Open bag, ${count} item${count === 1 ? '' : 's'}` : 'Open bag'}
          >
            <Bag />
            <span className={`cart-count${count > 0 ? ' show' : ''}`} aria-hidden="true">
              {count}
            </span>
          </button>
          <button
            className="burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Menu />
          </button>
        </div>
      </div>
      {/* `inert` while closed: the CSS collapse (max-height:0/opacity:0) hides
          the menu but does not take its 8-10 links out of the tab order or the
          accessibility tree, so keyboard and switch users used to walk through
          a stack of invisible links that scrolled nothing into view. */}
      <div id="mobile-menu" className={`mobile-menu${menuOpen ? ' open' : ''}`} inert={!menuOpen}>
        {[...LINKS, ...secondary].map((l) => (
          <Link key={l.to} to={l.to} onClick={() => handleLinkClick(l.to)}>
            {l.label}
          </Link>
        ))}
        <Link to={accountHref} onClick={() => setMenuOpen(false)}>
          {user ? (user.firstName ? `Hi, ${user.firstName}` : 'My dashboard') : 'Sign in'}
        </Link>
        {user && (
          <button type="button" className="nav-signout" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        )}
      </div>
    </header>
  )
}

'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Link } from '@/lib/router-compat'
import { Nav } from './Nav'
import { Footer } from './Footer'
import { IHome, ICycle, ISparkles, IChevron } from './AppIcons'

/**
 * MemberLayout — the shared chrome for every signed-in CUSTOMER surface.
 *
 * This replaces `src/app/Shell.tsx` for customers. Shell was the ADMIN console's
 * chrome being reused for shoppers, which is why a customer saw a left sidebar,
 * an "Admin dashboard" link, an "Administrator" persona and two permanently
 * disabled topbar buttons. None of that exists here.
 *
 * What a member page gets instead is the storefront's own chrome — the same
 * <Nav/> and <Footer/> every other page renders — wrapped around a `.m-area`
 * built from the `.m-*` primitives in `src/styles/member.css`.
 *
 * It is a client component so that both server pages (`app/account/page.tsx`)
 * and the already-client screens (`Account.tsx`, `UserDashboard.tsx`) can render
 * it without an RSC boundary puzzle. It holds no data of its own: identity is
 * passed in, resolved once on the server by `getAccountData()`.
 */

export type MemberNavKey = 'overview' | 'cycle' | 'rewards'

export interface MemberIdentity {
  /** AccountUser.displayName — the literal 'Your account' when the user is nameless. */
  displayName: string
  /** Two uppercase letters. Rendered when `image` is null. */
  initials: string
  tier: string
  /** Google avatar URL, or null. Initials are the fallback. */
  image: string | null
}

export interface MemberLayoutProps {
  identity: MemberIdentity
  active: MemberNavKey
  /** Page title, rendered as .m-title. Pass AccountUser.greeting on /account. */
  title: string
  /** One optional paragraph under the title. */
  lead?: string
  /** At most one per screen. */
  eyebrow?: string
  /** Right-aligned header slot — typically ONE .btn.btn-primary. */
  actions?: ReactNode
  /**
   * `'bare'` drops the `.m-head` title block and the `.m-bar` (sub-nav +
   * identity), keeping only the storefront chrome and the content well.
   *
   * /dashboard renders its own membership hero and its own three-way segmented
   * control, both of which carry the identity, the greeting and the section
   * switch. Painting `.m-head` above them would put the same name, the same
   * greeting and the same three destinations on the screen twice. `title`,
   * `lead`, `eyebrow` and `actions` are then unused — the screen owns them.
   */
  variant?: 'default' | 'bare'
  children: ReactNode
}

/**
 * The complete member sub-navigation. Orders, addresses and profile are
 * in-page sections of /account reached by that screen's own `.m-tabs`, not
 * destinations here — three links is the whole list.
 *
 * CRITICAL: no entry may ever point at /admin, /api/admin or /admin/login.
 * Admin reaches the console by typing the URL.
 */
const NAV: { key: MemberNavKey; label: string; to: string; Icon: typeof IHome }[] = [
  { key: 'overview', label: 'Overview', to: '/account', Icon: IHome },
  { key: 'cycle', label: 'Cycle', to: '/dashboard', Icon: ICycle },
  { key: 'rewards', label: 'Rewards', to: '/account#rewards', Icon: ISparkles },
]

/**
 * Sign out. Exported separately so the storefront <Nav/> mobile menu can mount
 * the same control. No confirm() — signing out is trivially reversible.
 */
export function MemberSignOutButton({
  className,
  /**
   * `'plain'` drops the default `.btn.btn-ghost` skin so a caller can dress the
   * control in its own system. /dashboard's hero sits on deep purple, where the
   * ghost button's dark border and dark label are invisible.
   */
  variant = 'default',
}: {
  className?: string
  variant?: 'default' | 'plain'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // The cookie clear happens server-side; a network failure still means the
      // user asked to leave, so fall through to the redirect rather than
      // stranding them on a page they believe they have signed out of.
    }
    // replace() so Back does not return to a member page, then refresh() so the
    // server components re-render against the now-absent session cookie.
    router.replace('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      className={
        variant === 'plain' ? (className ?? '') : `btn btn-ghost${className ? ` ${className}` : ''}`
      }
      onClick={signOut}
      disabled={busy}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

export function MemberLayout({
  identity,
  active,
  title,
  lead,
  eyebrow,
  actions,
  variant = 'default',
  children,
}: MemberLayoutProps) {
  if (variant === 'bare') {
    return (
      <>
        <div className="liquid-bg liquid-bg--fallback" aria-hidden="true" />
        <Nav />
        <div className="m-area">
          <div className="wrap m-page">{children}</div>
        </div>
        <Footer />
      </>
    )
  }

  return (
    <>
      {/* Same static lavender field the storefront layout paints. Fixed at
          z-index:-1, so it sits behind the content without a stacking context. */}
      <div className="liquid-bg liquid-bg--fallback" aria-hidden="true" />
      <Nav />

      <div className="m-area">
        <div className="wrap m-page">
          <header className="m-head">
            <div className="m-head__text">
              {eyebrow && <span className="eyebrow">{eyebrow}</span>}
              <h1 className="m-title">{title}</h1>
              {lead && <p className="m-lead">{lead}</p>}
            </div>
            {actions && <div className="m-head__actions">{actions}</div>}
          </header>

          <div className="m-bar">
            {/* Links between member destinations, so this is navigation with
                aria-current — not a tablist. /account's in-page sections use
                the real role="tablist" .m-tabs primitive. */}
            <nav className="m-subnav" aria-label="Member sections">
              {NAV.map(({ key, label, to, Icon }) => {
                const isActive = key === active
                return (
                  <Link
                    key={key}
                    to={to}
                    className={`m-subnav__link${isActive ? ' is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                )
              })}
            </nav>

            <div className="m-identity">
              <span className="m-identity__avatar" aria-hidden="true">
                {identity.image ? (
                  <img src={identity.image} alt="" width={38} height={38} decoding="async" />
                ) : (
                  identity.initials
                )}
              </span>
              <span className="m-identity__meta">
                <span className="m-identity__name">{identity.displayName}</span>
                <span className="m-identity__tier">{identity.tier}</span>
              </span>
              <span className="m-identity__actions">
                <Link to="/shop" className="m-linkbtn">
                  Shop
                  <IChevron aria-hidden="true" />
                </Link>
                <MemberSignOutButton />
              </span>
            </div>
          </div>

          <div className="m-stack">{children}</div>
        </div>
      </div>

      <Footer />
    </>
  )
}

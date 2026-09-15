'use client'

/**
 * react-router-dom → Next.js App Router compatibility shim.
 *
 * The storefront was built against react-router-dom. Rather than rewrite every
 * `<Link to=…>`, `useParams`, `useLocation` and `<Navigate>` call site across
 * ~14 files, we re-export Next-backed equivalents with the same API. Ported
 * components change only their import specifier:
 *
 *   - import { Link } from 'react-router-dom'   // before
 *   + import { Link } from '@/lib/router-compat' // after
 */

import NextLink from 'next/link'
import { useParams as useNextParams, usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'

type NextLinkProps = Omit<ComponentProps<typeof NextLink>, 'href'>

/** react-router `<Link to=…>` → Next `<Link href=…>`. */
export function Link({ to, children, ...rest }: { to: string; children?: ReactNode } & NextLinkProps) {
  return (
    <NextLink href={to} {...rest}>
      {children}
    </NextLink>
  )
}

/** react-router `<NavLink>` — the storefront uses it like a plain Link. */
export const NavLink = Link

/**
 * react-router `useLocation()`. Next exposes pathname via a hook; the hash is
 * only known on the client, so it is read from `window` after mount (matching
 * how the original hash-scroll behaviour ran client-side anyway).
 */
export function useLocation() {
  const pathname = usePathname() ?? '/'
  const [hash, setHash] = useState('')
  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [pathname])
  return { pathname, hash, search: typeof window !== 'undefined' ? window.location.search : '' }
}

/** react-router `useParams()` — Next's returns the same `{ id }` / `{ slug }` shape. */
export function useParams<T extends Record<string, string | string[]> = Record<string, string>>() {
  return (useNextParams() ?? {}) as T
}

/** react-router `<Navigate to=… replace />` → client-side replace after mount. */
export function Navigate({ to }: { to: string; replace?: boolean }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(to)
  }, [to, router])
  return null
}

export { useRouter }

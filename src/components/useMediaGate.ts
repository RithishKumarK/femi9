'use client'

import { useEffect, useState } from 'react'

/**
 * `true` once the client has confirmed `query` matches the viewport.
 *
 * The member and auth screens carry four decorative Figma exports that are
 * `display: none` on every mobile target — and `display: none` does not cancel a
 * download, so a 360px phone was still pulling a 2.5 MB PNG it would never
 * paint. Gating the element out of the JSX is the only thing that actually stops
 * the request.
 *
 * Returns `false` on the server and on the first client paint, so the markup is
 * hydration-stable; every consumer is an absolutely positioned or grid-pinned
 * decoration, so appearing one frame late costs no layout shift.
 */
export function useMediaGate(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])

  return matches
}

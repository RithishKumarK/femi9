'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { CartProvider } from '@/store/cart'
import { CycleModeProvider } from '@/immersive/CycleMode'
import { SmoothScroll, useLenis } from '@/immersive/SmoothScroll'
import { CartDrawer } from '@/components/CartDrawer'
import { ScrollMotion } from '@/components/ScrollMotion'
import { Toast } from '@/components/Toast'
import { stickyNavHeight } from '@/lib/sticky-nav'

/**
 * On route change, reset scroll to top (or to a hash target if present).
 * Ported from the old App.tsx ScrollManager; uses Next's pathname hook and the
 * shared Lenis instance so it stays in step with the smooth-scroll loop.
 */
function ScrollManager() {
  const pathname = usePathname()
  const lenis = useLenis()

  useEffect(() => {
    const hash = window.location.hash
    if (hash) {
      const el = document.getElementById(hash.slice(1))
      if (el) {
        // The offset used to be a hardcoded -70 against a 76px sticky bar, so
        // every hash landing hid 6px of the heading — and it could not know
        // about `env(safe-area-inset-top)`, which is non-zero now that the root
        // viewport is `viewport-fit: cover`. Measure the bar instead, using the
        // same helper the Nav's own in-page links use so the two cannot drift.
        const navH = stickyNavHeight()
        if (lenis) lenis.scrollTo(el, { offset: -(navH + 8) })
        else {
          // `scrollIntoView` takes no offset, and this is the branch that runs
          // on every phone (Lenis is off for coarse pointers).
          const top = el.getBoundingClientRect().top + window.scrollY - navH - 8
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
        return
      }
    }
    if (lenis) lenis.scrollTo(0, { immediate: true })
    else window.scrollTo({ top: 0 })
  }, [pathname, lenis])

  return null
}

/**
 * App-wide client providers, mirroring the old App.tsx tree:
 * CartProvider → CycleModeProvider → SmoothScroll, plus the global
 * CartDrawer and Toast overlays.
 *
 * ScrollMotion sits INSIDE SmoothScroll on purpose: Lenis owns how the page
 * travels, ScrollMotion owns what the page does while it travels, and the two
 * together are the Lumi9 scroll. It reads `window.scrollY` like any other
 * consumer, so it needs no reference to the Lenis instance.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <CycleModeProvider>
        <SmoothScroll>
          <ScrollManager />
          <ScrollMotion />
          {children}
          <CartDrawer />
          <Toast />
        </SmoothScroll>
      </CycleModeProvider>
    </CartProvider>
  )
}

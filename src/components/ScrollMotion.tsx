'use client'

/**
 * ScrollMotion — the site-wide half of the Lumi9 scroll.
 *
 * Mounted once in Providers. On every route change it walks the page and hands
 * each content block to the shared reveal observer in `@/lib/motion`, so the
 * fade-up entrance is a property of the SITE rather than something each screen
 * has to remember to wrap its markup in. Lumi9 gets the same effect by wrapping
 * elements in `<Reveal>` by hand; Femi9 has ~30 screens of existing markup, and
 * tagging them one by one would have been thirty chances to miss one.
 *
 * ── What counts as a block ──────────────────────────────────────────────────
 * The direct children of the page's `<main>`, after descending through any
 * single-child wrapper (`.pdp-page > main > .wrap` is three nodes deep before
 * the real content starts). That is what reads as a content block on every
 * screen in this app — `/shop` has no `<section>` element at all, so a
 * tag-name rule would have covered almost nothing.
 *
 * ── What is deliberately skipped ────────────────────────────────────────────
 *  · `main.figma-landing` (Home and About). Those screens already run their own
 *    IntersectionObserver entrance, keyed off `data-visible`. A second opacity
 *    animation on the very same node would cross-fade against the first.
 *  · Anything under `data-no-reveal` — the escape hatch, used on the PDP buy
 *    block, which reveals its own rows at a finer grain.
 *  · Sticky and fixed elements. A `translateY` on an ancestor makes it the
 *    containing block, which un-sticks whatever is inside for the length of the
 *    animation.
 *  · `/admin`, which is a data surface and runs no storefront motion at all.
 *
 * A failsafe pass reveals anything still hidden after four seconds, so a block
 * the observer never fires for (inside a collapsed parent, say) cannot end up
 * permanently invisible.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { observeParallax, observeReveal, prefersReducedMotion } from '@/lib/motion'

/**
 * `useLayoutEffect` runs after the DOM is committed but BEFORE the browser
 * paints, which is what lets a client-side navigation tag its blocks without
 * the shopper ever seeing them visible first. On the server it does not run at
 * all and React warns about it, hence the swap.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Stagger cap — four steps of 60ms, then everything after lands together. */
const STAGGER_MS = 60
const STAGGER_MAX = 4

const NEVER_REVEAL = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'BR', 'NOSCRIPT'])

function isSkipped(el: HTMLElement): boolean {
  if (NEVER_REVEAL.has(el.tagName)) return true
  if (el.hasAttribute('hidden')) return true
  if (el.dataset.shown === 'true') return true
  if (el.closest('[data-no-reveal]')) return true
  const position = getComputedStyle(el).position
  if (position === 'sticky' || position === 'fixed') return true
  return false
}

/**
 * Walk past wrappers that exist only to constrain width, so the reveal lands on
 * the blocks a reader perceives rather than on one box containing all of them.
 */
function contentContainer(main: HTMLElement): HTMLElement {
  let node: HTMLElement = main
  // Bounded: three levels is `.pdp-page > main > .wrap`, the deepest in the app.
  for (let depth = 0; depth < 3; depth += 1) {
    const children = Array.from(node.children) as HTMLElement[]
    const blocks = children.filter((child) => !NEVER_REVEAL.has(child.tagName))
    if (blocks.length !== 1) break
    const only = blocks[0]
    if (only.tagName !== 'DIV' && only.tagName !== 'SECTION') break
    if (only.children.length === 0) break
    node = only
  }
  return node
}

export function ScrollMotion() {
  const pathname = usePathname()
  /**
   * True for the first pass only. The server already painted this page before
   * React got here, so anything on screen must be left alone — see the
   * `skipIfOnScreen` note in lib/motion.ts. Every navigation after this one
   * tags before paint and can animate the whole viewport.
   */
  const firstPass = useRef(true)

  useIsomorphicLayoutEffect(() => {
    if (pathname?.startsWith('/admin')) return

    const cleanups: (() => void)[] = []
    const skipOnScreen = firstPass.current
    firstPass.current = false

    const tagReveal = (el: HTMLElement, index: number) => {
      if (isSkipped(el)) return
      const step = Math.min(index, STAGGER_MAX)
      if (step > 0) el.style.transitionDelay = `${step * STAGGER_MS}ms`
      cleanups.push(observeReveal(el, skipOnScreen))
    }

    const scan = () => {
      const mains = Array.from(document.querySelectorAll('main')) as HTMLElement[]
      for (const main of mains) {
        if (main.classList.contains('figma-landing')) continue
        if (main.closest('[data-no-reveal]')) continue
        const container = contentContainer(main)
        const children = Array.from(container.children) as HTMLElement[]
        children.forEach(tagReveal)
      }

      // Explicit opt-ins, anywhere on the page — these are the finer-grained
      // rows the PDP buy block asks for, and they carry their own stagger.
      const optIns = Array.from(document.querySelectorAll('[data-reveal-on]')) as HTMLElement[]
      for (const el of optIns) {
        if (isSkipped(el)) continue
        const delay = Number(el.dataset.revealOn)
        if (Number.isFinite(delay) && delay > 0) el.style.transitionDelay = `${delay}ms`
        cleanups.push(observeReveal(el, skipOnScreen))
      }

      // Decorative drift. `data-parallax` is the factor (0.06 slow … 0.35 hero).
      const drifters = Array.from(document.querySelectorAll('[data-parallax]')) as HTMLElement[]
      for (const el of drifters) {
        const factor = Number(el.dataset.parallax)
        const scale = Number(el.dataset.parallaxScale)
        cleanups.push(
          observeParallax(
            el,
            Number.isFinite(factor) && factor > 0 ? factor : 0.12,
            Number.isFinite(scale) && scale > 0 ? scale : 40,
          ),
        )
      }
    }

    // Before paint on the first pass; a second pass catches anything a child
    // component streamed in after hydration (the blog list, the catalog grid).
    scan()
    const settle = window.setTimeout(scan, 400)

    // Nothing may stay hidden. If an observer never fires for a node — it is
    // inside a `display:none` parent, the page is shorter than the threshold —
    // this is what puts the content back.
    const failsafe = window.setTimeout(() => {
      const stuck = document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-shown])')
      stuck.forEach((el) => {
        el.dataset.shown = 'true'
      })
    }, 4000)

    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(failsafe)
      cleanups.forEach((fn) => fn())
    }
  }, [pathname])

  // Reduced motion is honoured inside `observeReveal`, but the class hook is
  // useful for sheets that want to opt a whole area out of transitions.
  useEffect(() => {
    if (prefersReducedMotion()) document.documentElement.dataset.reducedMotion = 'true'
  }, [])

  return null
}

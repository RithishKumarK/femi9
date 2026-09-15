'use client'

/**
 * The Lumi9 scroll, ported to Femi9.
 *
 * Two primitives, both driven by ONE shared observer and ONE shared rAF loop no
 * matter how many nodes register:
 *
 *  · REVEAL   — a block fades up 28px into place the first time 12% of it
 *               enters the viewport, then stops being watched. Lumi9's
 *               `[data-reveal]` behaviour, same threshold, same easing.
 *  · PARALLAX — decorative art drifts against the scroll and, on a fine
 *               pointer, leans toward the cursor.
 *
 * This sits UNDERNEATH the existing Lenis instance rather than replacing it —
 * Lenis owns how the page travels, this owns what the page does while it
 * travels, and the combination is what the Lumi9 feel actually is. Lenis drives
 * `window.scrollY` like any other scroller, so the loop below needs to know
 * nothing about it.
 *
 * ── The one invariant worth protecting ──────────────────────────────────────
 * CSS hides ONLY what this file has already tagged (`[data-reveal]`), never a
 * class the server rendered. If the bundle fails, the observer is unsupported,
 * or the effect never runs, every block simply stays visible. A reveal system
 * that can blank a page when its JS is late is not worth the entrance.
 */

import { useEffect, useRef } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/* ═══════════════════════════════════════════════════════════════════════════
   REVEAL
   ═══════════════════════════════════════════════════════════════════════════ */

let revealObserver: IntersectionObserver | null = null

function getRevealObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (revealObserver) return revealObserver
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        show(entry.target as HTMLElement)
        revealObserver?.unobserve(entry.target)
      }
    },
    { threshold: 0.12 },
  )
  return revealObserver
}

function show(el: HTMLElement) {
  el.dataset.shown = 'true'
}

/**
 * Tag an element as a reveal target and start watching it.
 *
 * Returns an unobserve function. Safe to call twice on the same node — an
 * already-shown element is left alone, so a re-scan after a route change never
 * re-hides content the shopper has already read.
 *
 * `skipIfOnScreen` exists for exactly one moment: the first pass after a full
 * page load. The server sent visible HTML and the browser painted it before
 * React hydrated, so tagging an element the shopper can ALREADY SEE would blink
 * it out and fade it back — a flash caused by the entrance animation, which is
 * worse than having no entrance. On that pass, anything on screen is simply
 * marked shown; everything below the fold is off-screen, so tagging it costs
 * nothing visible and it animates in properly as she scrolls to it. Client-side
 * navigations pass `false`: there is no server paint to race, the tagging
 * happens before the browser paints, and the whole page can animate in.
 */
export function observeReveal(el: HTMLElement, skipIfOnScreen = false): () => void {
  if (el.dataset.shown === 'true') return () => {}

  if (prefersReducedMotion()) {
    el.dataset.reveal = ''
    show(el)
    return () => {}
  }

  const observer = getRevealObserver()
  if (!observer) {
    // No IntersectionObserver: show it and never hide it. The `data-reveal`
    // attribute is deliberately NOT set here — setting it is what arms the CSS.
    return () => {}
  }

  if (skipIfOnScreen) {
    const rect = el.getBoundingClientRect()
    // `bottom > 0` as well as `top < innerHeight`: a block the page was
    // restored mid-way through (a Back navigation, a hash landing) is on screen
    // even though its top is above the fold.
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      show(el)
      return () => {}
    }
  }

  el.dataset.reveal = ''
  observer.observe(el)
  return () => observer.unobserve(el)
}

/** Ref-based reveal, for a component that knows it wants one. */
export function useRevealRef<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeReveal(el)
  }, [])

  return ref
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARALLAX

   translate3d(pointerX · f · scale, −relativeScroll · f · 0.12 + pointerY · f ·
   scale·0.67, 0), with the pointer offset lerped at 0.06 a frame. Factors run
   0.06 (a slow column) to 0.35 (hero confetti).
   ═══════════════════════════════════════════════════════════════════════════ */

interface ParallaxNode {
  el: HTMLElement
  factor: number
  pointerScale: number
}

const nodes = new Set<ParallaxNode>()
let rafId: number | null = null
let pointerX = 0
let pointerY = 0
let targetX = 0
let targetY = 0
let listening = false

function onPointerMove(event: PointerEvent) {
  targetX = event.clientX / window.innerWidth - 0.5
  targetY = event.clientY / window.innerHeight - 0.5
}

function frame() {
  pointerX += (targetX - pointerX) * 0.06
  pointerY += (targetY - pointerY) * 0.06

  const scrollY = window.scrollY
  const viewportCenter = scrollY + window.innerHeight / 2

  for (const node of nodes) {
    const rect = node.el.getBoundingClientRect()
    const center = rect.top + scrollY + rect.height / 2
    const relative = viewportCenter - center
    const x = pointerX * node.factor * node.pointerScale
    const y = -relative * node.factor * 0.12 + pointerY * node.factor * (node.pointerScale * 0.67)
    node.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
  }

  rafId = nodes.size ? requestAnimationFrame(frame) : null
}

function startLoop() {
  if (!listening) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    listening = true
  }
  if (rafId === null) rafId = requestAnimationFrame(frame)
}

function stopLoop() {
  if (nodes.size > 0) return
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  if (listening) {
    window.removeEventListener('pointermove', onPointerMove)
    listening = false
  }
}

/** Register a node with the shared drift loop. Returns its unregister function. */
export function observeParallax(el: HTMLElement, factor = 0.2, pointerScale = 60): () => void {
  if (prefersReducedMotion()) return () => {}

  const node: ParallaxNode = { el, factor, pointerScale }
  nodes.add(node)
  el.style.willChange = 'transform'
  startLoop()

  return () => {
    nodes.delete(node)
    el.style.transform = ''
    el.style.willChange = ''
    stopLoop()
  }
}

/**
 * @param factor       drift strength, ~0.06 (slow column) to ~0.35 (hero confetti)
 * @param pointerScale px of pointer travel at factor 1 — 60 on a hero, 40 elsewhere
 */
export function useParallaxRef<T extends HTMLElement>(factor = 0.2, pointerScale = 60) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeParallax(el, factor, pointerScale)
  }, [factor, pointerScale])

  return ref
}

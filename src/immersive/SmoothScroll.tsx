import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const LenisContext = createContext<Lenis | null>(null)

/** Access the active Lenis instance (null under reduced motion / before mount). */
export const useLenis = () => useContext(LenisContext)

/**
 * The "Flow" scroll (spec §1). One Lenis smooth-scroll instance for the whole
 * app, driven from GSAP's ticker so Lenis and ScrollTrigger share a single rAF
 * loop instead of fighting over two.
 *
 * It no-ops in three cases, and all three matter:
 *
 *  - `prefers-reduced-motion: reduce` — the site falls back to native scrolling
 *    for anyone who asks for it. This used to be a module-scope `const`
 *    evaluated once at import, so toggling Reduce Motion mid-session did
 *    nothing until a full reload. It is now read inside the effect and the
 *    MediaQueryList is subscribed to, so the toggle takes effect immediately.
 *
 *  - `pointer: coarse` — a touchscreen already has hardware-accelerated
 *    momentum scrolling. Lenis runs with `syncTouch:false` there, so it was not
 *    even smoothing touch input; all it contributed was an unconditional rAF
 *    callback for the life of every page, on exactly the devices with the least
 *    frame budget. (`touchMultiplier` was only ever consulted in the synced
 *    path, so it was inert config that read as if touch were being tuned.)
 *
 *  - the ADMIN CONSOLE, which it broke outright. Lenis smooths the ROOT
 *    scroller: on a wheel event it walks from the target up to <html>, and
 *    unless something on the way carries `data-lenis-prevent` it calls
 *    preventDefault() and drives window.scrollTo itself. /admin pins
 *    `html, body { overflow: hidden }` and scrolls inside `.adm-main`, so the
 *    window has nowhere to go — every wheel tick over the console was
 *    swallowed and thrown away, and the panel simply would not scroll. (The
 *    scrollbar and the keyboard still worked, which is what made it look like
 *    a CSS fault rather than a hijacked event.) Tagging each admin scroller
 *    with `data-lenis-prevent` would also fix it, but there are several of
 *    them — the panel, the sidebar nav, the mobile drawer, every wide table —
 *    and one new scroller added later would silently break again. The console
 *    is a data surface that gains nothing from inertial scrolling, so it does
 *    not run it at all.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null)
  const pathname = usePathname()
  /** `/admin` and everything under it, including `/admin/login`. */
  const allowed = !pathname?.startsWith('/admin')

  useEffect(() => {
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mqCoarse = window.matchMedia('(pointer: coarse)')

    let instance: Lenis | null = null
    let raf: ((time: number) => void) | null = null

    const teardown = () => {
      if (raf) {
        gsap.ticker.remove(raf)
        // Put GSAP's frame-drop guard back the way we found it — it is global
        // state, and leaving it off after switching to a touch/reduced-motion
        // context would defeat the point of switching.
        gsap.ticker.lagSmoothing(500, 33)
      }
      raf = null
      if (instance) instance.destroy()
      instance = null
      setLenis(null)
    }

    const sync = () => {
      const wanted = allowed && !mqReduce.matches && !mqCoarse.matches
      if (!wanted) {
        teardown()
        return
      }
      if (instance) return

      const inst = new Lenis({
        // lerp-based smoothing gives a continuous, weighted glide (feels
        // smoother than a fixed per-input duration). ~0.09 is the premium sweet
        // spot: lower = floatier, higher = snappier.
        lerp: 0.09,
        smoothWheel: true,
        wheelMultiplier: 1,
        syncTouch: false,
        anchors: true,
      })
      instance = inst
      setLenis(inst)

      inst.on('scroll', ScrollTrigger.update)
      const tick = (time: number) => inst.raf(time * 1000)
      raf = tick
      gsap.ticker.add(tick)
      // lagSmoothing(0) removes GSAP's frame-drop guard. That is a reasonable
      // trade on a desktop driving a scrubbed timeline, and a bad one on a
      // mid-range phone — which is why it only runs on the fine-pointer path
      // this branch is now gated to.
      gsap.ticker.lagSmoothing(0)
    }

    sync()
    mqReduce.addEventListener('change', sync)
    mqCoarse.addEventListener('change', sync)

    return () => {
      mqReduce.removeEventListener('change', sync)
      mqCoarse.removeEventListener('change', sync)
      teardown()
    }
    // `allowed` re-runs this on the storefront ↔ console boundary, so entering
    // /admin destroys the instance and leaving it builds a fresh one.
  }, [allowed])

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>
}

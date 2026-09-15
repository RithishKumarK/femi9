'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { resolveBenefits, type ProductBenefit } from '../data/productBenefits'
import { OptImg } from '@/components/OptImg'
import type { OptImageBase } from '@/lib/opt-images'

/**
 * "Key Benefits" — an editorial figure: the Femi9 pack suspended in the air at
 * the centre, tilted, with thin curved threads running from its six claims to
 * points on the pack's edge.
 *
 * The floating pack is the studio shot `img/sample` (a pack photographed on
 * white), shown untouched. Two things make it float without editing the image:
 *
 * • It is cropped by CSS to the pack plus a white margin, and that margin is
 *   faded out with a mask, so no photo edge is ever visible.
 * • It uses `mix-blend-mode: multiply` over a white glow, so the white studio
 *   background drops away while the pack's own colours are multiplied by white
 *   — i.e. left exactly as they are.
 *
 * Blend-mode gotcha: multiply only reaches the section background if no element
 * between the pack and the section creates its own stacking context. So the
 * tilt and float live ON the blended element itself, never on a wrapper.
 *
 * The float is driven from JS, not a CSS animation, because the threads touch
 * the pack: every frame moves the pack and re-draws the six thread ends with it,
 * so a thread never detaches as the pack bobs. The loop pauses off-screen and
 * does not run at all under prefers-reduced-motion (the pack then rests still).
 *
 * Layout is still a three-column grid (claims · pack · claims) so real copy can
 * wrap freely. Below 900px the pack leads, the claims stack beneath, and there
 * are no threads — but the pack still floats.
 *
 * Content is unchanged: `resolveBenefits` supplies the same per-product pack
 * (or the DB features) as before.
 */

interface Props {
  productId: string
  productName: string
  /** DB-authored fallback when the product has no hand-written pack. */
  features: { title: string; body: string }[]
  /** Per-product shot. Kept in the contract; the floating figure uses the studio pack shot. */
  imageBase: OptImageBase | null
  /** Per-product catalog photo. Kept in the contract, see `imageBase`. */
  imageSrc: string
}

/** The studio pack shot on white — the only project image the pack can float from. */
const FLOAT_IMAGE: OptImageBase = 'img/sample'

/**
 * The crop, as fractions of the 2400×1792 source: the pack (measured at x 19–81%,
 * y 26–78%) plus a pure-white margin wide enough for the edge mask to fade.
 * The CSS in pdp-key-benefits.css (`.kb-float img`) is derived from these four
 * numbers — change them together.
 */
const CROP = { x: 0.14, y: 0.2, w: 0.72, h: 0.62 }

/** Where the pack itself sits inside the cropped box. */
const PACK_IN_CROP = {
  x0: (0.1917 - CROP.x) / CROP.w,
  y0: (0.2612 - CROP.y) / CROP.h,
  x1: (0.8075 - CROP.x) / CROP.w,
  y1: (0.7802 - CROP.y) / CROP.h,
}

/**
 * Where each thread touches the pack, in the pack's own unrotated coordinates
 * (0–1 across and down the pack). Just inside its outer edge — on the crimped
 * seam at the left, the blue flap at the right — so the point sits on the
 * packaging without covering the logo, the pad illustration or the size label.
 */
const TOUCH_POINTS: Record<'left' | 'right', [number, number][]> = {
  left: [
    [0.03, 0.12],
    [0.02, 0.5],
    [0.05, 0.9],
  ],
  right: [
    [0.97, 0.1],
    [0.985, 0.5],
    [0.96, 0.9],
  ],
}

/** Float: one full rise-and-fall, how high it rises, and the extra tilt at the top. */
const FLOAT_PERIOD_MS = 7000
const FLOAT_RISE_PX = 14
const FLOAT_EXTRA_TILT_DEG = 1.2

/** Stacked layout below this width — no threads there. */
const STACK_QUERY = '(max-width: 900px)'

interface Thread {
  sx: number
  sy: number
  u: number
  v: number
}

/** Everything a frame needs, captured by `measure` so the loop does no layout reads. */
interface Geometry {
  /** Untilted pack frame, relative to the layout. */
  px0: number
  py0: number
  pw: number
  ph: number
  /** Tilt pivot (the cropped box's centre), relative to the layout. */
  cx: number
  cy: number
  tiltDeg: number
  threads: Thread[]
}

/** The thread's path and its touch point for a given float offset and tilt. */
function threadPath(g: Geometry, t: Thread, lift: number, tiltDeg: number) {
  const rad = (tiltDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const x = g.px0 + g.pw * t.u
  const y = g.py0 + g.ph * t.v
  const cy = g.cy + lift
  const ex = g.cx + (x - g.cx) * cos - (y - g.cy) * sin
  const ey = cy + (x - g.cx) * sin + (y - g.cy) * cos
  const dx = ex - t.sx
  const dy = ey - t.sy
  // Leaves the dot level, swings wide, and settles onto the pack's edge.
  const d = `M ${t.sx} ${t.sy} C ${t.sx + dx * 0.62} ${t.sy - dy * 0.18}, ${ex - dx * 0.42} ${ey - dy * 0.62}, ${ex} ${ey}`
  return { d, ex, ey }
}

function Benefit({
  benefit,
  align,
  index,
}: {
  benefit: ProductBenefit
  align: 'left' | 'right'
  index: number
}) {
  const dot = <span className="kb-dot" data-kb-dot data-side={align} data-index={index} aria-hidden="true" />
  return (
    <li className={`kb-item kb-item--${align}`} style={{ '--kb-i': index } as CSSProperties}>
      <div className="kb-item-head">
        {align === 'right' && dot}
        <h3 className="kb-item-title">{benefit.title}</h3>
        {align === 'left' && dot}
      </div>
      <p className="kb-item-body">{benefit.body}</p>
    </li>
  )
}

export function KeyBenefits({ productId, productName, features }: Props) {
  const pack = resolveBenefits(productId, features)

  const layoutRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const shadowRef = useRef<HTMLSpanElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const geometry = useRef<Geometry | null>(null)

  /** Resting-pose paths, rendered by React; the float loop then updates them in place. */
  const [threads, setThreads] = useState<{ d: string; ex: number; ey: number }[]>([])
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  /** `armed` once JS runs (CSS may then hide items for their entrance); `inView` plays it. */
  const [armed, setArmed] = useState(false)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const layout = layoutRef.current
    const box = boxRef.current
    const floatEl = floatRef.current
    if (!layout || !box || !floatEl) return
    setArmed(true)

    const measure = () => {
      const lay = layout.getBoundingClientRect()
      // The sizing box is never transformed, so this is the pack's untilted frame.
      const b = box.getBoundingClientRect()
      const tiltDeg =
        parseFloat(getComputedStyle(layout.closest('.kb-section') ?? layout).getPropertyValue('--kb-tilt')) || -12

      const g: Geometry = {
        px0: b.left - lay.left + b.width * PACK_IN_CROP.x0,
        py0: b.top - lay.top + b.height * PACK_IN_CROP.y0,
        pw: b.width * (PACK_IN_CROP.x1 - PACK_IN_CROP.x0),
        ph: b.height * (PACK_IN_CROP.y1 - PACK_IN_CROP.y0),
        cx: b.left - lay.left + b.width / 2,
        cy: b.top - lay.top + b.height / 2,
        tiltDeg,
        threads: [],
      }

      if (!window.matchMedia(STACK_QUERY).matches) {
        layout.querySelectorAll<HTMLElement>('[data-kb-dot]').forEach((dot) => {
          const side = dot.dataset.side === 'right' ? 'right' : 'left'
          const points = TOUCH_POINTS[side]
          const [u, v] = points[Number(dot.dataset.index) % points.length]
          const r = dot.getBoundingClientRect()
          g.threads.push({ sx: r.left + r.width / 2 - lay.left, sy: r.top + r.height / 2 - lay.top, u, v })
        })
      }

      geometry.current = g
      setFrame({ w: lay.width, h: lay.height })
      setThreads(g.threads.map((t) => threadPath(g, t, 0, g.tiltDeg)))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(layout)

    // ── Float loop ──────────────────────────────────────────────────────────
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    let onScreen = false

    const tick = (now: number) => {
      const g = geometry.current
      if (g) {
        // 0 → 1 → 0 over one period, easing at both ends like ease-in-out.
        const phase = (1 - Math.cos((now / FLOAT_PERIOD_MS) * Math.PI * 2)) / 2
        const lift = -FLOAT_RISE_PX * phase
        const tilt = g.tiltDeg + FLOAT_EXTRA_TILT_DEG * phase

        floatEl.style.transform = `translateY(${lift}px) rotate(${tilt}deg)`
        if (shadowRef.current) {
          shadowRef.current.style.transform = `scaleX(${1 - 0.14 * phase})`
          shadowRef.current.style.opacity = String(1 - 0.35 * phase)
        }

        const svg = svgRef.current
        if (svg && g.threads.length) {
          const paths = svg.querySelectorAll<SVGPathElement>('.kb-thread')
          const ends = svg.querySelectorAll<SVGCircleElement>('.kb-touch')
          g.threads.forEach((t, i) => {
            const { d, ex, ey } = threadPath(g, t, lift, tilt)
            paths[i]?.setAttribute('d', d)
            ends[i]?.setAttribute('cx', String(ex))
            ends[i]?.setAttribute('cy', String(ey))
          })
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      if (!raf && onScreen && !reduceMotion.matches) raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const onMotionPref = () => {
      if (reduceMotion.matches) {
        stop()
        floatEl.style.transform = ''
        if (shadowRef.current) {
          shadowRef.current.style.transform = ''
          shadowRef.current.style.opacity = ''
        }
        measure() // back to the resting paths
      } else {
        start()
      }
    }
    reduceMotion.addEventListener('change', onMotionPref)

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = Boolean(entry?.isIntersecting)
        if (onScreen) {
          setInView(true)
          start()
        } else {
          stop()
        }
      },
      { threshold: 0.05 },
    )
    io.observe(layout)

    return () => {
      ro.disconnect()
      io.disconnect()
      stop()
      reduceMotion.removeEventListener('change', onMotionPref)
    }
    // Keyed on the product, not on `pack`: a DB-feature fallback is rebuilt on
    // every render, and depending on it would re-run this effect in a loop.
  }, [productId])

  // Nothing authored and nothing seeded — render nothing rather than an empty figure.
  if (!pack) return null

  const stateClass = `${armed ? ' is-armed' : ''}${inView ? ' is-in' : ''}`

  return (
    <section className={`kb-section${stateClass}`} aria-labelledby="kb-heading">
      <h2 className="kb-heading" id="kb-heading">
        Key Benefits
      </h2>

      <div className="kb-layout" ref={layoutRef}>
        <ul className="kb-col kb-col--left">
          {pack.left.map((b, i) => (
            <Benefit key={b.title} benefit={b} align="left" index={i} />
          ))}
        </ul>

        <div className="kb-stage">
          {/* Untransformed sizing box: measured for the threads, and it keeps the
              blended pack free of any stacking context between it and the section. */}
          <div className="kb-float-box" ref={boxRef}>
            {/* Decorative: every claim is read out as text on both sides. */}
            <div className="kb-float" ref={floatRef}>
              <OptImg
                base={FLOAT_IMAGE}
                sizes="(max-width: 560px) 125vw, (max-width: 900px) 620px, 780px"
                alt=""
              />
            </div>
          </div>
          <span className="kb-float-shadow" ref={shadowRef} aria-hidden="true" />
        </div>

        <ul className="kb-col kb-col--right">
          {pack.right.map((b, i) => (
            <Benefit key={b.title} benefit={b} align="right" index={i} />
          ))}
        </ul>

        {threads.length > 0 && (
          <svg
            ref={svgRef}
            className="kb-threads"
            width={frame.w}
            height={frame.h}
            viewBox={`0 0 ${frame.w} ${frame.h}`}
            aria-hidden="true"
            focusable="false"
          >
            {threads.map((t, i) => (
              <g key={i} style={{ '--kb-delay': `${200 + i * 110}ms` } as CSSProperties}>
                <path className="kb-thread" d={t.d} pathLength={1} />
                <circle className="kb-touch" cx={t.ex} cy={t.ey} r={3.5} />
              </g>
            ))}
          </svg>
        )}
      </div>

      {/* The product name is the region's accessible name, not printed text. */}
      <span className="kb-sr-only">{`Key benefits of ${productName}`}</span>
    </section>
  )
}

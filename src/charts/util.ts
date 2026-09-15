import { useEffect, useRef, useState } from 'react'

/**
 * Tooltips in these charts are shown on hover and hidden on `mouseleave`. A
 * finger has no `mouseleave`: the emulated mouse events fire once on tap and
 * nothing ever dismisses the tip, so it sticks until the next tap somewhere
 * else. Pair every pointer-down that OPENS a tip with this on pointer-up — it
 * closes the tip a beat later for touch and pen, and does nothing at all for a
 * mouse, so desktop hover is unchanged.
 */
export function useTouchDismiss(close: () => void, ms = 2600) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(close)
  latest.current = close
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (e: { pointerType: string }) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (e.pointerType === 'mouse') return
    timer.current = setTimeout(() => latest.current(), ms)
  }
}

/** Measure an element's width (ResizeObserver) so SVG charts stay responsive with pixel-accurate hover. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(w)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/** Linear scale factory. */
export function scale(d0: number, d1: number, r0: number, r1: number) {
  const m = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * m
}

/** "Nice" rounded upper bound + step for a y-axis, given a max value. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

/** Smooth cubic path through points (Catmull-Rom -> bezier). */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : ''
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.16
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`
  }
  return d
}

export const fmtInt = (n: number) => n.toLocaleString('en-IN')
export const fmtRs = (n: number) => 'Rs.' + n.toLocaleString('en-IN')
export const fmtRsK = (n: number) =>
  n >= 100000 ? 'Rs.' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? 'Rs.' + (n / 1000).toFixed(0) + 'k' : 'Rs.' + n
export const fmtCompact = (n: number) =>
  n >= 100000 ? (n / 100000).toFixed(1) + 'L' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)

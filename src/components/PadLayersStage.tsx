'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import './PadLayersStage.css'

/**
 * Scroll-scrubbed Femi9 pad. The frames are cut out of the studio video in
 * `video 1/`: the whole pad turning, separating into its layers, then the
 * layers drifting. Scroll position picks the frame, so scrolling back plays it
 * in reverse. The canvas backing store is capped to the frames' native width so
 * Retina phones do not upscale the raster artwork before displaying it.
 *
 * The frames are not an even sample of the video. The pad holds whole for ~2s
 * and separates in ~1s, so the separation is kept frame for frame and the holds
 * either side are thinned — that is what gives the split most of the scroll.
 */
const FRAME_COUNT = 110
const LAST = FRAME_COUNT - 1
const FRAME_W = 600
const FRAME_H = 1043
const MAX_DPR = 2
const CONCURRENCY = 4
/** The stretch of the sequence where the layers come apart (frames 15 → 48). */
const SPLIT_START = 15 / LAST
const SPLIT_END = 48 / LAST

const frameSrc = (index: number) =>
  `/assets/pad-frames-video/frame-${String(index + 1).padStart(3, '0')}.webp`

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const ease = (t: number) => {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

function explodeAt(progress: number) {
  return ease((progress - 0.12) / 0.3) * (1 - ease((progress - 0.58) / 0.3))
}

/**
 * Inside the pinned scroll story: a short beat on the whole pad, then the video
 * runs to its end over the rest of the track, finishing just before the pin
 * releases so the separated stack holds for a moment. Linear on purpose — the
 * video carries its own easing, and the frame chase in update() smooths the
 * scroll wheel's steps.
 */
function storyFrameAt(progress: number) {
  return clamp01((progress - 0.04) / 0.88)
}

export function PadLayersStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!stage || !canvas || !ctx) return

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const step = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches ? 2 : 1

    let destroyed = false
    let staticMode = reduceQuery.matches
    let listening = false
    let raf = 0
    let resizeTimer = 0
    let orientTimer = 0
    let drawn = -1
    let lastVar = -1
    let current = staticMode ? 1 : 0
    let target = current

    const images: (HTMLImageElement | null)[] = new Array(FRAME_COUNT).fill(null)
    const requested = new Set<number>()
    const queue: number[] = []
    const inFlight = new Set<HTMLImageElement>()

    const snap = (index: number) =>
      index === LAST ? LAST : Math.min(LAST, Math.round(index / step) * step)

    const nearestLoaded = (index: number) => {
      for (let d = 0; d < FRAME_COUNT; d++) {
        if (images[index - d]) return index - d
        if (images[index + d]) return index + d
      }
      return -1
    }

    // When the stage sits in the home page's pinned scroll story, progress is
    // how far the tall track has scrolled under its sticky pin (0 → 1), and it
    // is published as --why-p so the benefit cards can choreograph against the
    // same clock. Outside a story the original in-view curve is kept.
    const track = stage.closest<HTMLElement>('[data-why-story]')

    const progress = () => {
      if (staticMode) {
        track?.style.setProperty('--why-p', '1')
        return 1
      }
      if (track) {
        const r = track.getBoundingClientRect()
        const p = clamp01(-r.top / Math.max(1, r.height - window.innerHeight))
        track.style.setProperty('--why-p', p.toFixed(4))
        // Phones pin the product panel itself (sticky, offset under the nav).
        // Flag when it is actually stuck so CSS can fill the strip above it —
        // filling it always would cover the section heading before it sticks.
        // Desktop's panel is not sticky (top resolves to 'auto' → 0), where the
        // flag is unused.
        const stickyTop = parseFloat(getComputedStyle(stage.parentElement as HTMLElement).top) || 0
        track.dataset.stuck = String(r.top <= stickyTop + 1)
        return storyFrameAt(p)
      }
      const rect = stage.getBoundingClientRect()
      const height = stage.offsetHeight || rect.height
      const top = rect.top + (rect.height - height) / 2
      const vh = window.innerHeight
      return explodeAt(clamp01((vh - top) / (vh + height)))
    }

    const render = () => {
      const index = nearestLoaded(snap(Math.round(current * LAST)))
      if (index >= 0 && index !== drawn && canvas.width) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(images[index] as HTMLImageElement, 0, 0, canvas.width, canvas.height)
        drawn = index
        stage.dataset.ready = 'true'
      }
      // The halo and the slight zoom follow the layers coming apart, not the
      // whole sequence, so they bloom with the split and hold through the drift.
      const explode = ease((current - SPLIT_START) / (SPLIT_END - SPLIT_START))
      if (Math.abs(explode - lastVar) > 0.004) {
        lastVar = explode
        stage.style.setProperty('--why-explode', explode.toFixed(3))
      }
    }

    const schedule = () => {
      if (raf || destroyed) return
      raf = requestAnimationFrame(update)
    }

    function update() {
      raf = 0
      if (destroyed) return
      target = progress()
      current += (target - current) * 0.15
      if (Math.abs(target - current) < 0.002) current = target
      render()
      if (current !== target) schedule()
    }

    const pump = () => {
      while (!destroyed && inFlight.size < CONCURRENCY && queue.length) {
        const index = queue.shift() as number
        const img = new Image()
        img.decoding = 'async'
        inFlight.add(img)
        const settle = () => {
          inFlight.delete(img)
          pump()
        }
        img.onload = () => {
          const decoded = img.decode ? img.decode().catch(() => {}) : Promise.resolve()
          decoded.then(() => {
            if (destroyed) return
            images[index] = img
            drawn = -1
            schedule()
            settle()
          })
        }
        img.onerror = () => {
          if (!destroyed) settle()
        }
        img.src = frameSrc(index)
      }
    }

    const request = (indices: number[]) => {
      for (const index of indices) {
        if (requested.has(index)) continue
        requested.add(index)
        queue.push(index)
      }
      pump()
    }

    const requestFrames = () => {
      if (staticMode) {
        request([LAST])
        return
      }
      // Both ends and the middle of the split first, so a fast scroll always has
      // something close to draw while the rest fill in.
      const all = [0, LAST, snap(33)]
      for (let i = 0; i < LAST; i += step) all.push(i)
      request(all)
    }

    const sizeCanvas = () => {
      const cssWidth = Math.max(1, stage.clientWidth)
      const cssHeight = Math.max(1, stage.clientHeight)
      // Render at native asset resolution (or below), never above it.
      const nativeDprCap = FRAME_W / cssWidth
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR, nativeDprCap)
      const width = Math.max(1, Math.min(FRAME_W, Math.round(cssWidth * dpr)))
      const height = Math.max(1, Math.min(FRAME_H, Math.round(cssHeight * dpr)))
      if (!stage.clientWidth || (width === canvas.width && height === canvas.height)) return
      canvas.width = width
      canvas.height = height
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      drawn = -1
      schedule()
    }

    const onScroll = () => schedule()

    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        sizeCanvas()
        schedule()
      }, 150)
    }

    const onOrientation = () => {
      onResize()
      window.clearTimeout(orientTimer)
      orientTimer = window.setTimeout(() => {
        sizeCanvas()
        schedule()
      }, 400)
    }

    const onMotionPref = () => {
      staticMode = reduceQuery.matches
      if (staticMode) current = target = 1
      requestFrames()
      schedule()
    }

    const listen = (on: boolean) => {
      if (on === listening) return
      listening = on
      if (on) document.addEventListener('scroll', onScroll, { passive: true, capture: true })
      else document.removeEventListener('scroll', onScroll, { capture: true })
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          requestFrames()
          if (!listening && !staticMode) current = target = progress()
          render()
        }
        listen(entry.isIntersecting)
      },
      { rootMargin: '900px 0px' },
    )
    observer.observe(stage)

    const sizer = new ResizeObserver(sizeCanvas)
    sizer.observe(stage)
    sizeCanvas()

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientation)
    reduceQuery.addEventListener('change', onMotionPref)

    return () => {
      destroyed = true
      observer.disconnect()
      sizer.disconnect()
      listen(false)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      reduceQuery.removeEventListener('change', onMotionPref)
      cancelAnimationFrame(raf)
      window.clearTimeout(resizeTimer)
      window.clearTimeout(orientTimer)
      for (const img of inFlight) {
        img.onload = img.onerror = null
        img.src = ''
      }
      inFlight.clear()
      images.fill(null)
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className="fl-why__stage"
      role="img"
      aria-label="Femi9 pad, shown separating into its layers"
      style={{ '--frame-ratio': `${FRAME_W} / ${FRAME_H}` } as CSSProperties}
    >
      <img src={frameSrc(0)} alt="" width={FRAME_W} height={FRAME_H} decoding="async" />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}

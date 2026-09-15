import { useEffect, useRef, useState } from 'react'
import './CountUp.css'

/**
 * Counts the number(s) inside a stat up from zero, once, when it comes into
 * view ("Rs.8,000–20,000" would count both ends). It always lands on exactly
 * `value`: the server renders the final string, an invisible copy reserves its
 * width so the layout never jumps while digits grow, and screen readers only
 * ever get the final value. Reduced motion shows the final value straight away.
 */
export function CountUp({ value, delay = 0, duration = 1800 }: { value: string; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [text, setText] = useState(value)

  useEffect(() => {
    const el = ref.current
    const parts = value.split(/(\d[\d,]*)/)
    if (!el || parts.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const targets = parts.map((p, i) => (i % 2 ? Number(p.replace(/,/g, '')) : 0))

    const render = (t: number) =>
      parts
        .map((p, i) => {
          if (i % 2 === 0) return p
          const n = Math.round(targets[i] * t)
          return p.includes(',') ? n.toLocaleString('en-US') : String(n)
        })
        .join('')

    let raf = 0
    let timer = 0
    setText(render(0))

    const run = () => {
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - p, 4)
        setText(p < 1 ? render(eased) : value)
        if (p < 1) raf = window.requestAnimationFrame(step)
      }
      raf = window.requestAnimationFrame(step)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        timer = window.setTimeout(run, delay)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
      window.cancelAnimationFrame(raf)
    }
  }, [value, delay, duration])

  return (
    <span className="count-up" ref={ref}>
      <span className="count-up__ghost" aria-hidden="true">{value}</span>
      <span className="count-up__live" aria-hidden="true">{text}</span>
      <span className="count-up__sr">{value}</span>
    </span>
  )
}

'use client'

/**
 * Ref-based reveal and parallax, for markup that wants the entrance at a finer
 * grain than ScrollMotion's automatic block pass gives it.
 *
 * ScrollMotion covers whole pages; these cover one element. Both funnel into
 * the same observer and the same rAF loop in `@/lib/motion`, so a page using
 * both pays for one of each.
 */

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode, Ref } from 'react'
import { useParallaxRef, useRevealRef } from '@/lib/motion'

type RevealTag = 'div' | 'section' | 'article' | 'li' | 'h2' | 'h3' | 'p' | 'figure'

/** Fades and lifts its child into place when 12% of it enters the viewport. */
export function Reveal({
  as = 'div',
  className = '',
  delay,
  style,
  children,
  ...rest
}: ComponentPropsWithoutRef<'div'> & {
  as?: RevealTag
  /** stagger, in ms */
  delay?: number
}) {
  const ref = useRevealRef<HTMLDivElement>()
  const Tag = as as 'div'

  return (
    <Tag
      ref={ref as Ref<HTMLDivElement>}
      className={className}
      style={delay ? { transitionDelay: `${delay}ms`, ...style } : style}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/**
 * Drifts its children against the scroll, and toward the pointer on a fine
 * pointer. Decorative only — `aria-hidden` is the usual companion.
 *
 * @param factor       0.06 (a slow column) … 0.35 (hero confetti)
 * @param pointerScale px of pointer travel at factor 1 — 60 on a hero, 40 elsewhere
 */
export function Parallax({
  factor = 0.12,
  pointerScale = 40,
  className = '',
  style,
  children,
  'aria-hidden': ariaHidden,
}: {
  factor?: number
  pointerScale?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
  'aria-hidden'?: boolean
}) {
  const ref = useParallaxRef<HTMLDivElement>(factor, pointerScale)

  return (
    <div ref={ref} className={className} style={style} aria-hidden={ariaHidden}>
      {children}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Confirmation pulse for "add to bag" / "add to cart" controls.
 *
 * Adding to the cart is otherwise a silent success: the drawer badge ticks up
 * somewhere off in the header, and on a phone that badge is often outside the
 * shopper's field of view entirely. This gives the control she actually pressed
 * a moment of feedback of its own.
 *
 * Returns a boolean to drive a class and a `fire()` to call from onClick. The
 * flag flips off and back on across an animation frame rather than simply being
 * set true, so a second click while the first pulse is still running restarts
 * the animation instead of being swallowed — CSS will not replay an animation
 * whose class never left the element.
 */
export function useAddPulse(durationMs = 820): [boolean, () => void] {
  const [pulsing, setPulsing] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)

  // A card can unmount mid-pulse (filtering the grid, closing the drawer);
  // without this the timer fires setState on a dead component.
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const fire = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    setPulsing(false)
    frame.current = requestAnimationFrame(() => {
      setPulsing(true)
      timer.current = window.setTimeout(() => setPulsing(false), durationMs)
    })
  }, [durationMs])

  return [pulsing, fire]
}

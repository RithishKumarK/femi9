/**
 * Height of the sticky header bar, in CSS pixels, measured live.
 *
 * Three places used to scroll a hash target into view and each carried its own
 * idea of how tall the header is: `-70` in the route-change ScrollManager, a
 * bare `scrollIntoView()` (no offset at all) in the Nav's own link handler, and
 * a `scroll-margin-top: 96px` scoped to the landing page. The bar is 76px, so
 * every hash landing hid part of the heading it had just jumped to.
 *
 * Measured rather than constant because `.nav` now carries
 * `padding-top: env(safe-area-inset-top)` — the root viewport is
 * `viewport-fit: cover`, so on a notched device the bar is genuinely taller than
 * 76px and by a number only the browser knows.
 *
 * Deliberately NOT `#nav.offsetHeight`: the <header> also contains the mobile
 * menu, so that reads ~650px whenever the menu is open.
 */
export function stickyNavHeight(): number {
  if (typeof document === 'undefined') return 76
  const bar = document.querySelector<HTMLElement>('.nav-in')
  const header = document.getElementById('nav')
  const inset = header ? parseFloat(getComputedStyle(header).paddingTop) || 0 : 0
  return (bar?.offsetHeight ?? 76) + inset
}

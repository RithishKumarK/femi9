import type { SVGProps } from 'react'

const stroke = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  // Every call site in this app pairs the icon with visible text or an aria-label on
  // the control, so the graphic itself is decorative. Default it out of the a11y tree.
  // The preset is spread BEFORE {...p}, so a caller that genuinely needs an accessible
  // icon can still pass aria-hidden={false} role="img" aria-label="…".
  'aria-hidden': true,
}

/** Same rationale as `stroke`, for the filled brand marks that do not take the preset. */
const solid = { 'aria-hidden': true } as const

export const Bag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)

export const Leaf = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
    <path d="M2 21c0-3 1.85-5.36 5.08-6" />
  </svg>
)

export const Drop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M12 2s7 4 7 10a7 7 0 0 1-14 0c0-6 7-10 7-10Z" />
  </svg>
)

export const Recycle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M12 2v6l3-3M12 22a10 10 0 0 0 8.66-15M12 22a10 10 0 0 1-8.66-15M18 22h3v-3" />
  </svg>
)

export const ShieldCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M9 12l2 2 4-4" />
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
  </svg>
)

export const Truck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M1 3h13v13H1zM14 8h4l3 3v5h-7" />
    <circle cx="5.5" cy="18.5" r="1.8" />
    <circle cx="17.5" cy="18.5" r="1.8" />
  </svg>
)

export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} strokeWidth={2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const Menu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const Close = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} strokeWidth={2} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...stroke} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const Whatsapp = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...solid} {...p}>
    <path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.16L2 22l4.95-1.3A9.9 9.9 0 1 0 12.04 2Zm0 1.8a8.1 8.1 0 0 1 5.73 13.83A8.1 8.1 0 0 1 6.4 18.9l-.35-.21-2.94.77.79-2.86-.23-.37A8.1 8.1 0 0 1 12.04 3.8Zm4.66 11.5c-.25-.13-1.47-.72-1.7-.8-.23-.09-.4-.13-.56.13-.17.25-.65.8-.8.97-.14.17-.29.19-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.12-.14.16-.24.25-.41.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.48-.4-.41-.56-.42h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.42 1.02 2.59.13.17 1.77 2.7 4.3 3.79 1.6.69 2.23.75 3.03.63.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.23-.16-.48-.28Z" />
  </svg>
)

export const Instagram = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} {...solid} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const Facebook = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...solid} {...p}>
    <path d="M14 9h3V6h-3c-1.7 0-3 1.3-3 3v2H8v3h3v7h3v-7h3l1-3h-4V9c0-.6.4-1 1-1Z" />
  </svg>
)

export const Youtube = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} {...solid} {...p}>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
  </svg>
)

export const Linkedin = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...solid} {...p}>
    <path d="M6.5 8A1.5 1.5 0 1 0 6.5 5a1.5 1.5 0 0 0 0 3ZM5 10h3v9H5zM10 10h3v1.3c.5-.8 1.5-1.5 2.9-1.5 2.3 0 3.1 1.5 3.1 3.8V19h-3v-4.7c0-1.1-.4-1.9-1.4-1.9-.8 0-1.3.5-1.5 1.1-.1.2-.1.5-.1.8V19h-3z" />
  </svg>
)

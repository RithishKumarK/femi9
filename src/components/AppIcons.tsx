import type { SVGProps } from 'react'

const s = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  // Decorative by default: every control that renders one of these either shows a text
  // label beside it or carries its own aria-label, so the graphic is noise to a screen
  // reader. Spread before {...p}, so `aria-hidden={false} role="img" aria-label="…"`
  // still works at any call site that needs a genuinely meaningful icon.
  'aria-hidden': true,
}

export const IHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></svg>
)
export const ICycle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><rect x="3" y="4.5" width="18" height="16.5" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><path d="M12 18c-1.7-1.2-3.2-2.4-3.2-3.9a1.7 1.7 0 0 1 3.2-.7 1.7 1.7 0 0 1 3.2.7c0 1.5-1.5 2.7-3.2 3.9z" /></svg>
)
export const IBox = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
)
export const IUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>
)
export const ISliders = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M4 8h9M18 8h2M4 16h3M12 16h8" /><circle cx="15.5" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></svg>
)
export const IBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10.4 20a1.8 1.8 0 0 0 3.2 0" /></svg>
)
export const ISearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.2-4.2" /></svg>
)
export const IChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M3 21h18" /><rect x="5" y="10" width="3.4" height="8" rx="1" /><rect x="10.3" y="5" width="3.4" height="13" rx="1" /><rect x="15.6" y="13" width="3.4" height="5" rx="1" /></svg>
)
export const IUsers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.2a3.4 3.4 0 0 1 0 5.6M21 20c0-3-1.6-4.6-4-5" /></svg>
)
export const ITrend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>
)
export const IPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
)
export const ISparkles = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4L12 3z" /><path d="M19 14l.8 2.1L22 17l-2.2.9L19 20l-.8-2.1L16 17l2.2-.9L19 14z" /></svg>
)
export const IInfo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.4" /></svg>
)
export const ICheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><circle cx="12" cy="12" r="9" /><path d="M8.4 12.4l2.4 2.4 4.8-4.9" /></svg>
)
export const IAlert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M12 3.5l8.5 15h-17l8.5-15z" /><path d="M12 10v4M12 17v.5" /></svg>
)
export const IChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M9 6l6 6-6 6" /></svg>
)
export const IGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></svg>
)
/* Filled star: does not take the stroke preset, so it carries aria-hidden itself.
   The PDP paints five of these per rating row (ProductDetail.tsx) with the numeric
   rating rendered as text beside them — without this the row read as five unlabelled
   graphics to assistive tech. */
export const IStar = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8L12 3z" /></svg>
)
export const IThumbUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M7 10v10H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3Z" /><path d="M7 19h9.2a3 3 0 0 0 2.9-2.3l1.2-5A2.2 2.2 0 0 0 18.2 9H14l.6-3.1A2.4 2.4 0 0 0 12.2 3L7 10v9Z" /></svg>
)
export const IThumbDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M7 14V4H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3Z" /><path d="M7 5h9.2a3 3 0 0 1 2.9 2.3l1.2 5a2.2 2.2 0 0 1-2.1 2.7H14l.6 3.1a2.4 2.4 0 0 1-2.4 2.9L7 14V5Z" /></svg>
)
export const IRupee = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M6 4h12M6 8h12M15.5 4c0 4-2.5 6-6.5 6H6l7 8" /></svg>
)
export const ILeaf = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6" /></svg>
)
export const IMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
)

/* Member-area glyphs. Added by the Foundation track so the edit / delete /
   copy / reward / receipt affordances share one weight instead of each screen
   pasting a differently-stroked SVG. Same 24-box, 1.75 stroke, round joins. */
export const IPencil = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20z" /><path d="M13.5 7.5l3 3" /></svg>
)
export const ITrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M4 7h16" /><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" /><path d="M6.5 7l.8 12.1a1.9 1.9 0 0 0 1.9 1.8h5.6a1.9 1.9 0 0 0 1.9-1.8L17.5 7" /><path d="M10.5 11v6M13.5 11v6" /></svg>
)
export const ICopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" /></svg>
)
export const IGift = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><rect x="3.5" y="8.5" width="17" height="4" rx="1.4" /><path d="M5 12.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5" /><path d="M12 8.5V21" /><path d="M12 8.5S11 3 8.6 3a2.3 2.3 0 0 0 0 5.5zM12 8.5S13 3 15.4 3a2.3 2.3 0 0 1 0 5.5z" /></svg>
)
export const IDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><path d="M12 3.5v11" /><path d="M8 11l4 4 4-4" /><path d="M4.5 16.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" /></svg>
)
export const ICard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s} {...p}><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 9.5h19M6 15h3.5" /></svg>
)

import type { ReactElement, SVGProps } from 'react'
import type { BenefitIconKey } from '../data/productBenefits'

/**
 * Line-art emblems for the PDP "Key Benefits" section.
 *
 * Kept out of Icons.tsx on purpose: those are the app's UI glyphs (bag, close,
 * chevron) used across every screen, whereas these are product-story emblems
 * that exist for exactly one section and are addressed by `BenefitIconKey`
 * rather than imported one by one. Mixing them would mean the nav bundle pulls
 * in twenty-five drawings it never renders.
 *
 * Same preset as Icons.tsx — 24px box, currentColor stroke, decorative by
 * default — so a badge here sits at the same optical weight as the icons
 * beside it elsewhere on the page.
 */
const stroke = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  // The benefit title next to each pair carries the meaning; the drawings are
  // decoration. Same rationale as Icons.tsx.
  'aria-hidden': true,
}

type Icon = (p: SVGProps<SVGSVGElement>) => ReactElement

/** Extended rear coverage — a pad silhouette with a length measure beside it. */
const Length: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="7" y="3" width="7" height="18" rx="3.5" />
    <path d="M18 4v16" />
    <path d="M16.5 4h3M16.5 20h3" />
  </svg>
)

/** Side wings anchoring the pad. */
const Wings: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="9.5" y="3" width="5" height="18" rx="2.5" />
    <path d="M9.5 9 4 7v6l5.5-2" />
    <path d="M14.5 9 20 7v6l-5.5-2" />
  </svg>
)

/** Anion strip — a chip emitting energy pulses. */
const Anion: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="8" y="9" width="8" height="6" rx="2" />
    <path d="M12 9V5M12 15v4" />
    <path d="M5.5 7.5a9 9 0 0 0 0 9M18.5 7.5a9 9 0 0 1 0 9" />
  </svg>
)

/** Organic cotton — a sprouting boll. */
const Cotton: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M12 21v-7" />
    <path d="M12 14c0-3 2-5 5-5 0 3-2 5-5 5Z" />
    <path d="M12 14c0-3-2-5-5-5 0 3 2 5 5 5Z" />
    <circle cx="12" cy="6" r="3" />
  </svg>
)

/** Multi-layer core — stacked absorbent sheets. */
const Layers: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="m12 3 8 4-8 4-8-4 8-4Z" />
    <path d="m4 12 8 4 8-4" />
    <path d="m4 17 8 4 8-4" />
  </svg>
)

/** Zero toxin — a leaf carrying a check. */
const ToxinFree: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
    <path d="m9 12.5 2 2 4-4" />
  </svg>
)

/** Sizing / coverage — a pad outline with a widened rear panel. */
const Coverage: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M9 3h6a2 2 0 0 1 2 2v8a5 5 0 0 1-1.6 3.7L12 21l-3.4-4.3A5 5 0 0 1 7 13V5a2 2 0 0 1 2-2Z" />
    <path d="M7 9h10" />
  </svg>
)

/** Freshness — a leaf with a rising breeze. */
const Freshness: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M13 18a6 6 0 0 1-1-11.9C16 5 17.5 4.5 19 3c.8 1.6 1.5 3.4 1.5 6.5 0 4.7-3.8 8.5-7.5 8.5Z" />
    <path d="M3 20h6M3 16.5h3.5" />
  </svg>
)

/** Fluid distribution channels. */
const Channels: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="6" y="3" width="12" height="18" rx="4" />
    <path d="M10 8v8M14 8v8" />
  </svg>
)

/** Soft cottony feel — a cloud. */
const Soft: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 9.2 3.9 3.9 0 0 1 16.6 18Z" />
  </svg>
)

/** Continuous airflow. */
const Airflow: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M3 8h10a3 3 0 1 0-3-3" />
    <path d="M3 12h14a3 3 0 1 1-3 3" />
    <path d="M3 16h7" />
  </svg>
)

/** Leak protection — a shield. */
const Shield: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M12 21s7-3.4 7-9V5.5L12 3 5 5.5V12c0 5.6 7 9 7 9Z" />
  </svg>
)

/** Overnight capacity — a crescent with a drop. */
const Moon: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
    <path d="M15.5 5.5c.9.7 1.4 1.5 1.4 2.3a1.4 1.4 0 1 1-2.8 0c0-.8.5-1.6 1.4-2.3Z" />
  </svg>
)

/** Trial pack — a small gift pouch. */
const Trial: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M5 9h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z" />
    <path d="M9 9V6.5a3 3 0 0 1 6 0V9" />
  </svg>
)

/** Certification seal. */
const Seal: Icon = (p) => (
  <svg {...stroke} {...p}>
    <circle cx="12" cy="9.5" r="6.5" />
    <path d="m9.2 9.6 2 2 3.6-3.7" />
    <path d="m8.5 15.5-1 5.5 4.5-2.3 4.5 2.3-1-5.5" />
  </svg>
)

/** Travel friendly — a compact handbag. */
const Pouch: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="3" y="8" width="18" height="12" rx="3" />
    <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
  </svg>
)

/** Rash-free — a shield sheltering skin. */
const RashFree: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M12 21s7-3.4 7-9V5.5L12 3 5 5.5V12c0 5.6 7 9 7 9Z" />
    <path d="M9 11.5h6" />
  </svg>
)

/** Instant absorption — a drop entering a locking core. */
const Absorb: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M12 2.5s4.5 4.8 4.5 8a4.5 4.5 0 0 1-9 0c0-3.2 4.5-8 4.5-8Z" />
    <path d="M5 17.5h14M6.5 21h11" />
  </svg>
)

/** Washable — water with a rotation arrow. */
const Wash: Icon = (p) => (
  <svg {...stroke} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M4.5 13c2.5-1.6 4-1.6 6.5 0s4 1.6 6.5 0" />
    <path d="M14.5 4.6 17 6l-1.3 2.4" />
  </svg>
)

/** Cotton weave. */
const Weave: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />
  </svg>
)

/** 360-degree coverage. */
const Degrees360: Icon = (p) => (
  <svg {...stroke} {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="5.5" />
    <path d="M12 6.5a9 5.5 0 0 0 0 11" />
    <path d="m8.5 4.8 2 1.7-2 1.7" />
  </svg>
)

/** Odour and bacteria guard. */
const Odour: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M12 21s6.5-3.2 6.5-8.5V6L12 3.5 5.5 6v6.5C5.5 17.8 12 21 12 21Z" />
    <path d="M9.5 12.5c1-1.2 2-1.2 3 0s2 1.2 3 0" />
  </svg>
)

/** Featherweight profile. */
const Feather: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M20 4c0 7-4.8 11.5-9.5 11.5H6.5C6.5 9.5 12 4 20 4Z" />
    <path d="M4 21 12 13" />
  </svg>
)

/** All-day freshness sparkle. */
const Sparkle: Icon = (p) => (
  <svg {...stroke} {...p}>
    <path d="M12 3.5 13.7 9 19 10.5 13.7 12 12 17.5 10.3 12 5 10.5 10.3 9Z" />
    <path d="M18 16.5 18.7 18.6 20.5 19.5 18.7 20.4 18 22.5 17.3 20.4 15.5 19.5 17.3 18.6Z" />
  </svg>
)

/** Full-length adhesive strip. */
const Adhesive: Icon = (p) => (
  <svg {...stroke} {...p}>
    <rect x="8.5" y="3" width="7" height="18" rx="3" />
    <path d="M10.5 7.5v9M13.5 7.5v9" strokeDasharray="2 2.4" />
  </svg>
)

/** Every emblem, addressed by the key the benefit packs carry. */
export const BENEFIT_ICONS: Record<BenefitIconKey, Icon> = {
  length: Length,
  wings: Wings,
  anion: Anion,
  cotton: Cotton,
  layers: Layers,
  toxinFree: ToxinFree,
  coverage: Coverage,
  freshness: Freshness,
  channels: Channels,
  soft: Soft,
  airflow: Airflow,
  shield: Shield,
  moon: Moon,
  trial: Trial,
  seal: Seal,
  pouch: Pouch,
  rashFree: RashFree,
  absorb: Absorb,
  wash: Wash,
  weave: Weave,
  degrees360: Degrees360,
  odour: Odour,
  feather: Feather,
  sparkle: Sparkle,
  adhesive: Adhesive,
}

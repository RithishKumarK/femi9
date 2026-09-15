'use client'

import type { CSSProperties, ReactNode } from 'react'
import { CATEGORY_META, type BlogCategory } from '../data/blog'
import type { BlogPostDTO } from '@femi9/core/services/blog'
import { OptImg } from '@/components/OptImg'
import { OPT_IMAGES, type OptImageBase } from '@/lib/opt-images'

/**
 * Cover URLs arrive as runtime strings from Postgres, so they cannot be typed
 * against the generated derivative manifest at the call site. Normalise the
 * public path onto a manifest key ('/assets/img/blogs/pcos-pcod.png' →
 * 'img/blogs/pcos-pcod') and return null when there is no ladder on disk — an
 * editor-supplied absolute URL, or an asset too small to be worth resizing.
 */
export function optImageBase(src: string): OptImageBase | null {
  const key = src
    .trim()
    .replace(/^\/+/, '')
    .replace(/^assets\//, '')
    .replace(/\.[a-z0-9]+$/i, '')
  return Object.prototype.hasOwnProperty.call(OPT_IMAGES, key) ? (key as OptImageBase) : null
}

/* ============================================================
   BlogCover — a designed editorial cover for every post.
   No photos, no blank tiles: each post gets a category-themed
   gradient + a signature motif, with the composition seeded off
   the slug so two posts in the same category never look alike.
   ============================================================ */

/* deterministic per-slug RNG (mulberry32 seeded via FNV-1a) */
function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)

/* signature motif per category, anchored + rotated by the seed */
function bigMotif(cat: BlogCategory, c: string, r: () => number): ReactNode {
  const ax = between(r, 176, 236) // anchor x
  const ay = between(r, 96, 132) // anchor y
  const rot = between(r, -16, 16)
  const s = between(r, 0.92, 1.16)
  const t = `translate(${ax} ${ay}) rotate(${rot}) scale(${s})`

  switch (cat) {
    case 'Cycle & Hormones':
      return (
        <g transform={t} fill="none" stroke={c}>
          <ellipse cx="0" cy="0" rx="82" ry="82" strokeOpacity=".28" strokeWidth="1.5" />
          <ellipse cx="0" cy="0" rx="54" ry="54" strokeOpacity=".2" strokeWidth="1.5" />
          <circle cx="0" cy="-82" r="9" fill={c} fillOpacity=".55" stroke="none" />
          <path d="M-30 0 a30 30 0 1 0 60 0 a18 30 0 0 1 -60 0z" fill={c} fillOpacity=".4" stroke="none" />
        </g>
      )
    case 'Comfort & Care':
      return (
        <g transform={t} fill="none" stroke={c} strokeLinecap="round">
          <path d="M-70 44 a70 70 0 0 1 140 0" strokeOpacity=".22" strokeWidth="2" />
          <path d="M-50 44 a50 50 0 0 1 100 0" strokeOpacity=".3" strokeWidth="2" />
          <path d="M-30 44 a30 30 0 0 1 60 0" strokeOpacity=".4" strokeWidth="2.5" />
          <circle cx="0" cy="44" r="7" fill={c} fillOpacity=".5" stroke="none" />
        </g>
      )
    case 'Skin & Body':
      return (
        <g transform={t} fill="none" stroke={c}>
          <circle cx="0" cy="0" r="14" fill={c} fillOpacity=".45" stroke="none" />
          <circle cx="0" cy="0" r="30" strokeOpacity=".34" strokeWidth="1.5" />
          <circle cx="0" cy="0" r="50" strokeOpacity=".24" strokeWidth="1.5" />
          <circle cx="0" cy="0" r="72" strokeOpacity=".16" strokeWidth="1.5" />
        </g>
      )
    case 'Sustainability':
      return (
        <g transform={t}>
          <path
            d="M0 60 C -46 30 -46 -34 4 -60 C 10 -6 8 34 0 60 Z"
            fill={c}
            fillOpacity=".4"
          />
          <path d="M2 -52 C -2 -8 -1 26 0 56" fill="none" stroke={c} strokeOpacity=".5" strokeWidth="1.6" />
          <path d="M0 60 C 46 30 46 -34 -4 -60 C -10 -6 -8 34 0 60 Z" fill={c} fillOpacity=".22" />
        </g>
      )
    case 'Product Guides':
      return (
        <g transform={t}>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={-58 + i * 5}
              y={-46 + i * 22}
              width={116 - i * 10}
              height="13"
              rx="6.5"
              fill={c}
              fillOpacity={0.18 + i * 0.08}
            />
          ))}
        </g>
      )
    case 'Community':
    default: {
      const nodes = [
        [0, 0, 11],
        [-52, -22, 7],
        [48, -30, 6],
        [40, 34, 8],
        [-40, 38, 6],
      ] as const
      return (
        <g transform={t}>
          {nodes.slice(1).map(([x, y], i) => (
            <line key={i} x1="0" y1="0" x2={x} y2={y} stroke={c} strokeOpacity=".3" strokeWidth="1.4" />
          ))}
          {nodes.map(([x, y, rr], i) => (
            <circle key={i} cx={x} cy={y} r={rr} fill={c} fillOpacity={i === 0 ? 0.5 : 0.34} />
          ))}
        </g>
      )
    }
  }
}

/* a scatter of small category glyphs for texture */
function miniGlyph(cat: BlogCategory, x: number, y: number, size: number, c: string, key: number): ReactNode {
  const op = 0.22
  switch (cat) {
    case 'Sustainability':
      return (
        <path
          key={key}
          transform={`translate(${x} ${y}) scale(${size / 20})`}
          d="M0 10 C -8 5 -8 -6 1 -10 C 2 -1 1 6 0 10 Z"
          fill={c}
          fillOpacity={op}
        />
      )
    case 'Skin & Body':
      return (
        <path
          key={key}
          transform={`translate(${x} ${y}) scale(${size / 18})`}
          d="M0 -10 C 5 -3 8 0 8 4 A8 8 0 1 1 -8 4 C -8 0 -5 -3 0 -10 Z"
          fill={c}
          fillOpacity={op}
        />
      )
    case 'Product Guides':
      return <rect key={key} x={x - size} y={y - size / 3} width={size * 2} height={size / 1.5} rx={size / 3} fill={c} fillOpacity={op} />
    case 'Comfort & Care':
      return (
        <path
          key={key}
          transform={`translate(${x} ${y})`}
          d={`M${-size} 0 a${size} ${size} 0 0 1 ${size * 2} 0`}
          fill="none"
          stroke={c}
          strokeOpacity={op + 0.06}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )
    case 'Cycle & Hormones':
      return <circle key={key} cx={x} cy={y} r={size} fill="none" stroke={c} strokeOpacity={op + 0.06} strokeWidth="1.4" />
    case 'Community':
    default:
      return <circle key={key} cx={x} cy={y} r={size / 2} fill={c} fillOpacity={op} />
  }
}

/* How wide the cover actually renders, per breakpoint. Getting this wrong is the
   one way to defeat the srcset, so these track the real CSS boxes:
   - deep  = .mtile, 1 column under 560px, 2 up to 900px, ~480px in the 1120px wrap
   - light = .bcard-poster in .bgrid, 1 column under 560px, up to 3 tracks desktop
   The article hero passes its own, wider value. */
const SIZES_DEEP = '(max-width: 560px) 92vw, (max-width: 900px) 48vw, 480px'
const SIZES_LIGHT = '(max-width: 560px) 92vw, (max-width: 900px) 44vw, 360px'

export function BlogCover({
  post,
  variant = 'light',
  className = '',
  priority = false,
  sizes,
  svgFit = 'slice',
}: {
  post: BlogPostDTO
  variant?: 'light' | 'deep'
  className?: string
  /** Set on the article hero only — it is that page's LCP element. */
  priority?: boolean
  /** Override the default `sizes` when the cover renders in a wider box. */
  sizes?: string
  /**
   * The generated SVG cover is authored at 320x220 (1.45). `slice` fills a box
   * of a similar ratio; `meet` letterboxes instead of cropping, which is what a
   * wide hero needs. The parent paints the gradient behind it either way.
   */
  svgFit?: 'slice' | 'meet'
}) {
  // category arrives as a plain string on the DTO; narrow it to the known union
  // for the CATEGORY_META lookup and the motif helpers below.
  const cat = post.category as BlogCategory
  const { color, tint } = CATEGORY_META[cat] ?? { color: '#7B4FA6', tint: 'linear-gradient(150deg,#F2ECF9,#D6C2EC)' }
  const deep = variant === 'deep'
  const r = makeRng(post.slug + variant)

  if (post.image) {
    const base = optImageBase(post.image)
    const imgSizes = sizes ?? (deep ? SIZES_DEEP : SIZES_LIGHT)
    // CSS drives the painted size; the width/height attributes OptImg emits are
    // what reserve the box before the bytes land.
    const fill: CSSProperties = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: 'center',
      display: 'block',
    }
    return (
      <span
        className={`bcover bcover--has-image bcover--${variant} ${className}`}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'block', background: '#272355' }}
        aria-hidden="true"
      >
        {base ? (
          /* Serves the pre-built WebP ladder: a 360px phone pulls a ~30 KB 360w
             file instead of the 4.9 MB 2718x1818 PNG this used to hand it. */
          <OptImg base={base} sizes={imgSizes} alt="" priority={priority} style={fill} />
        ) : (
          <img
            src={post.image}
            alt=""
            width={1280}
            height={808}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
            style={fill}
          />
        )}
        {deep && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              // Light on purpose: the tile's own scrim carries text legibility, so
              // this only deepens the lower edge instead of dimming the whole photo.
              background: 'linear-gradient(180deg, rgba(52, 32, 78, 0) 0%, rgba(52, 32, 78, 0) 45%, rgba(52, 32, 78, 0.35) 100%)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        )}
      </span>
    )
  }

  // deep covers (featured hero / article) use a plum→accent gradient with light
  // motifs; light covers (cards / teaser) use the pale category tint with the
  // accent as ink. Text overlays read cleanly on both.
  const bg = deep ? `linear-gradient(150deg, #33204E 0%, ${color} 128%)` : tint
  const ink = deep ? '#ffffff' : color
  const gid = `bg-${post.slug}-${variant}`

  const blobs = [
    { cx: between(r, 30, 110), cy: between(r, 30, 90), rr: between(r, 70, 110) },
    { cx: between(r, 220, 300), cy: between(r, 130, 200), rr: between(r, 60, 100) },
  ]
  const minis = Array.from({ length: 5 }, (_, i) => ({
    x: between(r, 20, 300),
    y: between(r, 20, 200),
    s: between(r, 4, 9),
    k: i,
  }))

  return (
    <span className={`bcover bcover--${variant} ${className}`} style={{ background: bg }} aria-hidden="true">
      <svg
        className="bcover-art"
        viewBox="0 0 320 220"
        preserveAspectRatio={`xMidYMid ${svgFit}`}
        role="presentation"
        focusable="false"
      >
        <defs>
          <radialGradient id={gid} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={ink} stopOpacity={deep ? 0.24 : 0.16} />
            <stop offset="100%" stopColor={ink} stopOpacity="0" />
          </radialGradient>
        </defs>
        {blobs.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.rr} fill={`url(#${gid})`} />
        ))}
        {minis.map((m) => miniGlyph(cat, m.x, m.y, m.s, ink, m.k))}
        {bigMotif(cat, ink, r)}
      </svg>
    </span>
  )
}

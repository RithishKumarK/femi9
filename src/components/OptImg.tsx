import { OPT_IMAGES, type OptImageBase } from '@/lib/opt-images'

/**
 * Responsive <img> over the WebP derivatives built by `scripts/build-images.mjs`.
 *
 * The Figma export left the site serving multi-megabyte PNGs at desktop
 * resolution to every phone — a single blog cover was 4.9 MB, and the landing
 * page pulled ~19 MB. This emits a srcset over the pre-built ladder so a 360px
 * phone downloads a 360px file.
 *
 * Callers name the image and say how wide it renders; the intrinsic size and the
 * available widths come from the generated manifest, so a srcset can never drift
 * out of step with what is actually on disk. `base` is typed against that
 * manifest, which means a typo or a deleted asset is a build error rather than a
 * broken image in production.
 *
 * The width/height attributes are always emitted: without them the browser
 * reserves no space and the image shoves the page down as it lands. CSS still
 * controls the displayed size — pair with `height: auto`.
 */

export interface OptImgProps {
  /** Asset path without extension, e.g. `figma-home/hero-lifestyle`. */
  base: OptImageBase
  /**
   * The `sizes` attribute — how wide this renders, per breakpoint. Getting it
   * wrong is the one way to defeat the whole pipeline, so state the real CSS
   * width (e.g. `(max-width: 760px) 82vw, 470px`), not `100vw`.
   */
  sizes: string
  /** Empty string marks the image decorative; it is then hidden from AT. */
  alt: string
  className?: string
  /** Set on the LCP image only. Everything else stays lazy. */
  priority?: boolean
  style?: React.CSSProperties
  /** Escape hatch for art direction that must not be lazy but is not the LCP. */
  loading?: 'eager' | 'lazy'
}

const OPT = '/assets/opt/'

/**
 * The srcset for an asset, for callers that cannot use <OptImg> — chiefly the
 * `<link rel="preload" imageSrcSet>` in app/layout.tsx. Deriving both from the
 * same manifest is what keeps the preload and the element in agreement: if they
 * disagree the browser fetches one derivative for the preload and a different
 * one for the element, and the phone pays for both.
 */
export function optSrcSet(base: OptImageBase): string {
  return OPT_IMAGES[base].sizes.map((w) => `${OPT}${base}-${w}.webp ${w}w`).join(', ')
}

/** The largest derivative — the `href`/`src` fallback for browsers without srcset. */
export function optSrc(base: OptImageBase): string {
  const { sizes } = OPT_IMAGES[base]
  return `${OPT}${base}-${sizes[sizes.length - 1]}.webp`
}

export function OptImg({ base, sizes, alt, className, priority = false, style, loading }: OptImgProps) {
  const entry = OPT_IMAGES[base]

  return (
    <img
      className={className}
      style={style}
      src={optSrc(base)}
      srcSet={optSrcSet(base)}
      sizes={sizes}
      width={entry.w}
      height={entry.h}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
    />
  )
}

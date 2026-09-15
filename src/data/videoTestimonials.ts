/**
 * Video testimonials shown on the product page and in the landing rail.
 *
 * ── How to add one ──────────────────────────────────────────────────────────
 * 1. Put the video in `public/assets/testimonials/` (MP4, H.264, muted-safe).
 *    Keep it short — the rail plays each clip END TO END before moving to the
 *    next, so 10-40s is the useful range. A three-minute clip parks the rail.
 * 2. Put a poster frame beside it (JPG/WebP). The poster is what a visitor
 *    sees on every card that is not the one playing, and it is REQUIRED:
 *    without one the card is a black rectangle, and the browser has to start
 *    downloading the video just to paint a first frame.
 * 3. Add an entry below.
 *
 * ── Why a hand-written list ─────────────────────────────────────────────────
 * The files cannot be enumerated at runtime (there is no directory listing in a
 * static bundle), and each clip needs a speaker name that no filename carries.
 * Keeping it explicit also means an unfinished upload never appears on the
 * storefront by accident.
 *
 * `products` scopes a clip to particular product slugs. Leave it out and the
 * clip shows on every product page — right for general brand testimonials,
 * wrong for one that names a specific pack.
 *
 * While this array is empty the section renders nothing at all, rather than an
 * empty frame with a heading over it.
 */

export interface VideoTestimonial {
  /** Stable key. Also used as the DOM id suffix, so keep it slug-like. */
  id: string
  /** Path under /public, e.g. `/assets/testimonials/priya.mp4`. */
  src: string
  /** Poster frame path. Required — see above. */
  poster: string
  /**
   * Who is speaking.
   *
   * Not drawn on the card — the rail is uncaptioned. It is the accessible name
   * for the clip: every control on the card is labelled with it ("Play Sapna
   * Iyer's story"), so it is what a screen reader announces and what a visitor
   * navigating by keyboard hears. Keep it a real person's name.
   */
  name: string
  /** Restrict to these product slugs. Omit to show on every product. */
  products?: string[]
}

/**
 * Where the clips are served from.
 *
 * SITE-RELATIVE is the real pattern — no CDN hostname hardcoded, exactly as
 * `app/api/admin/upload/route.ts` returns `/uploads/<name>` for product photos:
 *
 *   local dev    public/uploads/testimonials/  (served by Next, gitignored)
 *   staging      s3://femi9-staging-uploads-…/uploads/testimonials/
 *                via the `/uploads/*` CloudFront behavior (infra/terraform/cloudfront.tf)
 *
 * This standalone preview copy has neither: no local files (never committed —
 * 11MB of binary in every clone is not a thing to do) and no `/uploads/*`
 * proxy in front of it, so a relative path 404s here with nothing to fall back
 * to. Pinned to the staging CloudFront distribution instead so the rail has
 * something to actually play. Revert to the relative path once this copy is
 * rejoined with an environment that proxies `/uploads/*` itself.
 */
const BASE = 'https://d24too9me3angh.cloudfront.net/uploads/testimonials'

/**
 * Transcoded from the `Testimonial Videos/` source folder: the vertical "Short"
 * cut of each, scaled to 720x1280 and re-encoded at CRF 30 with a 64kbps mono
 * audio track. The originals are 30-65MB apiece, which is not a thing to put on
 * a product page — these land at roughly 1-2.6MB each with a poster frame.
 *
 * To publish a new or replaced clip, upload it under the same prefix:
 *   aws s3 cp <file> s3://femi9-staging-uploads-851725383246/uploads/testimonials/ \
 *     --profile femi9-staging --content-type video/mp4 \
 *     --cache-control "public, max-age=2592000"
 *
 * No `products` filter on any of them: they are general brand testimonials
 * rather than clips about one specific pack. Add the field to scope one.
 */
export const VIDEO_TESTIMONIALS: VideoTestimonial[] = [
  { id: 'nayan', src: `${BASE}/nayan.mp4`, poster: `${BASE}/nayan.jpg`, name: 'Nayanthara' },
  { id: 'sapna', src: `${BASE}/sapna.mp4`, poster: `${BASE}/sapna.jpg`, name: 'Sapna Iyer' },
  { id: 'sharmika', src: `${BASE}/sharmika.mp4`, poster: `${BASE}/sharmika.jpg`, name: 'Dr. Sharmika' },
  { id: 'mukilarasi', src: `${BASE}/mukilarasi.mp4`, poster: `${BASE}/mukilarasi.jpg`, name: 'Mukilarasi' },
  { id: 'malaysia', src: `${BASE}/malaysia.mp4`, poster: `${BASE}/malaysia.jpg`, name: 'Malaysia' },
  { id: 'pooja', src: `${BASE}/pooja.mp4`, poster: `${BASE}/pooja.jpg`, name: 'Pooja' },
]

/** The clips that belong on a given product page, in authored order. */
export function testimonialsForProduct(productId: string): VideoTestimonial[] {
  return VIDEO_TESTIMONIALS.filter((t) => !t.products || t.products.includes(productId))
}

/**
 * Where a catalogue image is allowed to come from.
 *
 * The console used to accept ANY string in a product's image row, because the
 * field was a free-text "Image URL" box an editor typed into. That is now an
 * upload button — the bytes go to `/<brand>/api/upload`, which sniffs the magic
 * number and puts the object in the private S3 uploads bucket — but a schema
 * that still accepts arbitrary text is not a fix. The form is UI; this is the
 * enforcement, and it is what a crafted POST to /<brand>/api/products meets.
 *
 * Three shapes are legitimate, and nothing else is:
 *
 *   /uploads/<name>          what the upload route returns. In production that
 *                            path is a CloudFront behavior reading the private
 *                            bucket through Origin Access Control; in dev it is
 *                            public/uploads on disk. Same URL either way, which
 *                            is the whole point of the site-relative return.
 *   /assets/<path>           an asset shipped inside the image. Both brands'
 *                            seeds write these (`/assets/products/m-24.jpeg`),
 *                            so rejecting them would make every seeded product
 *                            unsaveable in the console.
 *   https://res.cloudinary.com/…  the other provider branch in the upload route.
 *
 * Everything else is refused: an off-site https URL (which would hotlink a
 * third party from our product pages and leak our shoppers' referrers to them),
 * `data:` and `javascript:` (stored XSS wherever a URL reaches an attribute
 * that executes), protocol-relative `//evil.com`, and any `..` traversal.
 *
 * Deliberately free of `server-only` and of every runtime import: the console's
 * forms want the same predicate for inline validation as the API enforces, so
 * there is ONE definition of "an image we host" rather than a client copy that
 * drifts from the server's.
 */

/** Path segments we serve images from, each rooted at the site origin. */
const ALLOWED_PATH_PREFIXES = ['/uploads/', '/assets/'] as const

/** Hosts the upload route can hand back a fully-qualified URL for. */
const ALLOWED_HOSTS = new Set(['res.cloudinary.com'])

/**
 * Is `value` an image URL this platform is responsible for?
 *
 * Returns false for anything empty, malformed, or pointing off-platform. The
 * caller decides what that means — the zod schemas below it turn a false into a
 * field error the form shows next to the offending row.
 */
export function isManagedImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const url = value.trim()
  if (!url) return false

  // A backslash is never meaningful in a URL we generate, and is how several
  // parser-confusion tricks are spelled. Reject before anything else looks at it.
  if (url.includes('\\')) return false

  if (url.startsWith('/')) {
    // `//host` is protocol-relative — an absolute URL wearing a path's clothes.
    if (url.startsWith('//')) return false
    // `/uploads/../../etc` normalises out of the prefix we just checked for.
    if (url.includes('..')) return false
    return ALLOWED_PATH_PREFIXES.some((prefix) => url.startsWith(prefix) && url.length > prefix.length)
  }

  // Anything else must be a fully-qualified https URL on a host we publish from.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return ALLOWED_HOSTS.has(parsed.hostname)
}

/** The message every schema shows for a rejected URL, so the console says one
 *  thing about it rather than four slightly different things. */
export const MANAGED_IMAGE_URL_MESSAGE =
  'Images must be uploaded here — an external or hand-typed URL is not allowed.'

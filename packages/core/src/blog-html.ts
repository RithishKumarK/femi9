import 'server-only'
import sanitizeHtml from 'sanitize-html'
import { isManagedImageUrl } from './image-url'

/**
 * Sanitiser for blog post rich-HTML bodies authored in the admin's Tiptap
 * editor. Runs on every write in blog-admin.ts::createPost/updatePost, so an
 * operator (or a compromised admin session) cannot inject <script>, inline
 * event handlers, or off-origin images that would double as tracking pixels.
 *
 * Allowlist mirrors what the Tiptap StarterKit + Link + Image extensions can
 * emit. Anything the editor cannot produce should not survive the round-trip;
 * anything it can produce and we do not want (e.g. inline styles) is stripped
 * here rather than in the CSS.
 */

const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h2', 'h3',
  'strong', 'em', 'u', 's', 'code',
  'ul', 'ol', 'li',
  'blockquote',
  'a', 'img',
]

const ALLOWED_ATTR: Record<string, string[]> = {
  a: ['href', 'title', 'rel', 'target'],
  img: ['src', 'alt', 'width', 'height'],
}

/**
 * True when a sanitised HTML string carries no meaningful reader-visible
 * content — e.g. `<p></p>`, `<p><br></p>`, whitespace, or nothing. Tiptap
 * emits `<p></p>` for an empty editor, and a save-with-nothing-typed used to
 * persist that shell into `bodyHtml`, so the storefront's
 * `if (post.bodyHtml)` check would run, render empty HTML, and hide the
 * `body[]` fallback that had the actual content.
 *
 * Every read path treats "empty-ish" the same as null; every write path
 * refuses to store it.
 */
export function isEmptyBlogHtml(html: string | null | undefined): boolean {
  if (!html) return true
  // Strip every tag and every HTML entity that renders as blank, then check
  // whether ANY glyph survived. Cheap-and-correct: we do not need a parser
  // for "is this basically empty", and a parser round-trip on every read
  // would cost 10-100× more than a regex over ~1KB of text.
  const stripped = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, '')
    .replace(/&#160;/g, '')
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, 'x') // real content — keep as a placeholder glyph
    .trim()
  return stripped.length === 0
}

export function sanitizeBlogHtml(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return sanitizeHtml(trimmed, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTR,
    // http/https only. mailto and tel excluded on purpose: an editor who wants
    // to publish a phone number should type it plainly, not link to it.
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { a: ['http', 'https'] },
    // No inline styles or classes — presentation lives in the storefront's
    // CSS, not in what a copy editor pastes.
    disallowedTagsMode: 'discard',
    transformTags: {
      // Every <a> gets safe defaults: opens in a new tab, and rel prevents the
      // target page from swapping window.opener on us.
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          href: attribs.href ?? '',
          ...(attribs.title ? { title: attribs.title } : {}),
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      }),
    },
    // Only allow images from paths our own upload flow produces. An admin
    // pasting a random <img src="https://…"> would otherwise become a
    // tracking beacon for whoever owns that host.
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') {
        const src = frame.attribs?.src ?? ''
        return !isManagedImageUrl(src)
      }
      return false
    },
  })
}

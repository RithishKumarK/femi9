import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { isEmptyBlogHtml } from '../blog-html'

/**
 * Blog service — the single seam between the database and the marketing pages.
 *
 * DB rows are mapped back onto the existing `BlogPost` shape (src/data/blog.ts)
 * so the blog list/detail components consume live content with no structural
 * change. `category` is flattened to the category *name* via the BlogCategory
 * relation, and `date` is a display string derived from `publishedAt` (the DB
 * keeps a real timestamp; the UI only ever showed the formatted label).
 *
 * ── The <head> layer ────────────────────────────────────────────────────────
 * `metaTitle`, `imageAlt`, `keywords`, `cta` and `faqs` drive <title>, Open
 * Graph and JSON-LD rather than the rendered card. Lumi9's journal shipped them
 * in a module and could not move here without them; Femi9's rows do not set
 * them yet, so each one falls back to something the page can render today
 * (`metaTitle` → `title`, `imageAlt` → `title`, the rest empty). Nothing that
 * reads this DTO has to branch on which brand wrote the row.
 *
 * `date` stays the formatted label the cards print. `published` and `updated`
 * are the ISO timestamps beside it, because `datePublished` in structured data
 * and `<time dateTime>` need a machine-readable value and "July 2, 2026" is not
 * one — a page that fed the display string to both looked right and emitted an
 * invalid date to every crawler.
 */

export interface BlogFaqDTO {
  q: string
  a: string
}

export interface BlogPostDTO {
  slug: string
  title: string
  category: string
  /** The category's own accent colour and chip tint, carried on the post so a
   *  card does not need a second lookup against the category list. */
  categoryColor: string
  categoryTint: string
  excerpt: string
  author: string
  /** Display label, e.g. 'July 2, 2026'. */
  date: string
  /** ISO 8601 — what structured data and <time dateTime> need. */
  published: string
  /** ISO 8601 of the last edit, for `dateModified`. */
  updated: string
  readTime: number
  tone: string
  image?: string
  imageAlt: string
  featured?: boolean
  body: string[]
  /** Sanitised HTML from the admin Tiptap editor. When present the storefront
   *  renders this and ignores `body`. Null / empty for posts that haven't been
   *  re-saved through the rich editor yet — the block renderer is the fallback. */
  bodyHtml: string | null
  /** <title> for the article route. Falls back to `title`. */
  metaTitle: string
  /** Every keyword the meta tag should carry — the three typed lists merged
   *  with the legacy `keywords` column, deduped, order preserved. Storefront
   *  uses this directly. */
  keywords: string[]
  /** The three typed lists as the console authored them. Not usually
   *  rendered directly — kept on the DTO so any surface that wants to know
   *  which term is a primary target vs semantic backup can. Empty arrays
   *  when no term of that class was set. */
  keywordsPrimary: string[]
  keywordsSecondary: string[]
  keywordsSemantic: string[]
  /** The article's own closing call-to-action; empty means "use the generic one". */
  cta: string
  faqs: BlogFaqDTO[]
}

export interface BlogCategoryDTO {
  name: string
  color: string
  tint: string
}

// featured first, then newest — the order the storefront grid expects.
/** Trim + drop empties + drop dupes, preserving order. Used to merge the
 *  three typed keyword lists into one meta-tag string. */
function dedupeStrings(parts: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts) {
    const trimmed = raw.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

const POST_ORDER = [{ featured: 'desc' }, { publishedAt: 'desc' }] as const

/** Every relation `toPost` reads, in one place so the four queries below cannot
 *  drift into returning posts with and without their FAQ blocks. */
const POST_INCLUDE = {
  category: true,
  faqs: { orderBy: { position: 'asc' } },
} as const

function loadRows(brand: Brand) {
  const prisma = dbFor(brand)
  return prisma.blogPost.findMany({
    where: { status: 'approved' },
    orderBy: [...POST_ORDER],
    include: POST_INCLUDE,
  })
}

type Row = Awaited<ReturnType<typeof loadRows>>[number]

/** Map a DB row → the `BlogPost` shape the cards/detail page expect. */
function toPost(row: Row): BlogPostDTO {
  return {
    slug: row.slug,
    title: row.title,
    category: row.category.name,
    categoryColor: row.category.color,
    categoryTint: row.category.tint,
    excerpt: row.excerpt,
    author: row.author,
    // e.g. 'July 2, 2026' — matches the display strings the static data shipped.
    // Fixed locale and UTC so the server and the client render the same string;
    // a machine-local format would hydrate differently for a reader east of us.
    date: row.publishedAt.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    published: row.publishedAt.toISOString(),
    updated: row.updatedAt.toISOString(),
    readTime: row.readTime,
    tone: row.tone,
    image: row.image ?? undefined,
    // Never the empty string: alt="" tells a screen reader the image is
    // decorative, and an article's cover photograph is not.
    imageAlt: row.imageAlt || row.title,
    featured: row.featured,
    body: row.body,
    // Empty-ish HTML (`<p></p>`, `<p><br></p>`, whitespace) is treated the
    // same as null — the storefront's `if (post.bodyHtml)` check has to be
    // meaningful, not "was the column touched". Fixes legacy rows that stored
    // an empty Tiptap shell and hid the `body[]` fallback that had content.
    bodyHtml: isEmptyBlogHtml(row.bodyHtml) ? null : row.bodyHtml,
    metaTitle: row.metaTitle || row.title,
    // Merge primary + secondary + semantic + legacy `keywords`, dedupe,
    // order preserved (primary first, secondary next, semantic last, then
    // whatever old `keywords` still had). A post that has been re-saved
    // through the new form has an empty legacy column and only the three
    // typed lists contribute; a post that hasn't still gets its old bag.
    keywords: dedupeStrings([
      ...row.keywordsPrimary,
      ...row.keywordsSecondary,
      ...row.keywordsSemantic,
      ...row.keywords,
    ]),
    keywordsPrimary: row.keywordsPrimary,
    keywordsSecondary: row.keywordsSecondary,
    keywordsSemantic: row.keywordsSemantic,
    cta: row.cta ?? '',
    faqs: row.faqs.map((faq) => ({ q: faq.question, a: faq.answer })),
  }
}

/** All approved posts, featured first then newest. */
export async function listPosts(brand: Brand): Promise<BlogPostDTO[]> {
  const rows = await loadRows(brand)
  return rows.map(toPost)
}

/** One approved post by slug, or null. */
export async function getPost(brand: Brand, slug: string): Promise<BlogPostDTO | null> {
  const prisma = dbFor(brand)
  const row = await prisma.blogPost.findFirst({
      where: { slug, status: 'approved' },
      include: POST_INCLUDE,
    })
  return row ? toPost(row) : null
}

/** Category chips — mirrors CATEGORY_META (name → color / tint). */
export async function listCategories(brand: Brand): Promise<BlogCategoryDTO[]> {
  const prisma = dbFor(brand)
  const cats = await prisma.blogCategory.findMany({ orderBy: { name: 'asc' } })
  return cats.map((c) => ({ name: c.name, color: c.color, tint: c.tint }))
}

/** Up to `n` related posts: same category first, then most-recent others. */
export async function relatedPosts(brand: Brand, slug: string, n = 3): Promise<BlogPostDTO[]> {
  const prisma = dbFor(brand)
  const current = await prisma.blogPost.findFirst({
      where: { slug, status: 'approved' },
      select: { categoryId: true },
    })
  if (!current) return []

  const sameCat = await prisma.blogPost.findMany({
    where: { status: 'approved', slug: { not: slug }, categoryId: current.categoryId },
    orderBy: { publishedAt: 'desc' },
    include: POST_INCLUDE,
    take: n,
  })

  const picked = [...sameCat]
  // Backfill from other categories when the same category can't fill `n`.
  if (picked.length < n) {
    const excludeSlugs = [slug, ...picked.map((p) => p.slug)]
    const others = await prisma.blogPost.findMany({
      where: { status: 'approved', slug: { notIn: excludeSlugs } },
      orderBy: { publishedAt: 'desc' },
      include: POST_INCLUDE,
      take: n - picked.length,
    })
    picked.push(...others)
  }

  return picked.map(toPost)
}

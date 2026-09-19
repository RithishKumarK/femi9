import 'server-only'
import { z } from 'zod'
import { dbFor, type Brand } from '@femi9/db'
import { isManagedImageUrl, MANAGED_IMAGE_URL_MESSAGE } from '../../image-url'
import { isEmptyBlogHtml, sanitizeBlogHtml } from '../../blog-html'

/**
 * Admin blog/content service — the write-side CMS for BlogPost rows. Mirrors the
 * shape of src/lib/services/admin/products.ts so the console stays one system:
 * a zod-validated input, auto-unique slug derivation, and thin read/write fns
 * the route handlers call.
 *
 * The one blog-specific twist is `body`: the DB column is String[] (one entry per
 * paragraph, a leading "## " marking a heading and "> " a pull-quote — the same
 * convention the storefront renderer already reads). The editor is a single
 * textarea, so the service is the seam that turns the typed text into that array
 * on write and the pages join it back for the textarea on read.
 *
 * **Blocks are separated by a BLANK LINE, not by a single newline.** A bullet or
 * numbered list is ONE block carrying its own newlines - that is the contract
 * `ArticleBody` renders against, because a `<p>` per bullet would let HTML
 * whitespace collapsing eat every separator. Splitting on every newline turned a
 * five-bullet list into five one-item lists, silently, the first time an editor
 * opened such a post and pressed Save. `joinBody` below is the matching half,
 * and the edit page MUST use it rather than joining with a single newline.
 */

// ─────────────────────────── Validation (zod) ───────────────────────────
// z.coerce on readTime so a JSON payload carrying "4" (from an <input>) is
// accepted as well as 4 — the form sends strings for numeric fields.

export const BlogPostInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  // Blank slug => auto-derived from the title and made unique in the service.
  slug: z.string().trim().optional().default(''),
  categoryId: z.string().trim().min(1, 'Category is required'),
  // excerpt/author/tone are NOT NULL in the schema; default '' keeps the form
  // forgiving while still writing a valid row (same stance as the product form).
  excerpt: z.string().trim().default(''),
  author: z.string().trim().default(''),
  readTime: z.coerce.number().int().min(1, 'Read time must be ≥ 1').default(4),
  tone: z.string().trim().default(''),
  // Empty image => null so the column stays NULL rather than an empty string.
  // A present one must be an image WE host — the editor's cover field is an
  // upload button, and this is the half of that rule a crafted request meets.
  image: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || isManagedImageUrl(v), MANAGED_IMAGE_URL_MESSAGE),
  featured: z.boolean().default(false),
  status: z.enum(['pending', 'approved', 'hidden']).default('approved'),
  // Raw textarea text — one block per BLANK-LINE-separated chunk; split into the
  // String[] column below. Kept for legacy posts written before the rich editor.
  body: z.string().default(''),
  // Rich HTML from the Tiptap editor. When non-empty, the storefronts render
  // this and ignore `body`. Sanitised on write via sanitizeBlogHtml so an
  // operator cannot inject <script>, event handlers, or off-origin <img> tags.
  bodyHtml: z.string().default(''),

  // ── The <head> layer ─────────────────────────────────────────────────────
  // Optional everywhere: a post saved without them renders exactly as it did
  // before, because the read service falls back to `title` and `excerpt`.
  metaTitle: z.string().trim().default(''),
  imageAlt: z.string().trim().default(''),
  // Legacy single bucket. Accepts the array a JSON client sends OR the
  // comma/newline-separated string the old single input yielded. Kept for
  // API back-compat and still carried on the row as a merged fallback for
  // storefronts that read only this column.
  keywords: z
    .union([z.array(z.string()), z.string()])
    .default([])
    .transform(splitKeywords),
  // Three SEO buckets — primary target, secondary supporting, semantic /
  // topical. Same union parser as `keywords` so the same server accepts a
  // JSON array from a script and a chip-list from the form.
  keywordsPrimary: z
    .union([z.array(z.string()), z.string()])
    .default([])
    .transform(splitKeywords),
  keywordsSecondary: z
    .union([z.array(z.string()), z.string()])
    .default([])
    .transform(splitKeywords),
  keywordsSemantic: z
    .union([z.array(z.string()), z.string()])
    .default([])
    .transform(splitKeywords),
  cta: z.string().trim().default(''),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().default(''),
        answer: z.string().trim().default(''),
      }),
    )
    .default([])
    // A half-filled row is an editor mid-thought, not an error worth refusing a
    // save for — and a blank question in FAQPage markup is a validator failure.
    .transform((rows) => rows.filter((r) => r.question && r.answer)),
})

export type BlogPostInput = z.infer<typeof BlogPostInputSchema>

/** `'a, b
c'` → `['a','b','c']`, de-duplicated, order preserved. */
function splitKeywords(value: string[] | string): string[] {
  const parts = Array.isArray(value) ? value : value.split(SPLIT_KEYWORDS)
  return dedupeKeywords(parts)
}

/** Trim + drop empties + drop dupes, preserving order. Exported for reuse by
 *  postColumns when it merges the three typed lists into the legacy column. */
function dedupeKeywords(parts: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

// ───────────────────────────── Slug helpers ─────────────────────────────

function slugify(source: string): string {
  return source
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolve a unique slug. Derives from `source`, then appends -2, -3, … until it
 * finds a free one. `excludeId` lets an edit keep its own slug. The DB unique
 * index is the real backstop (P2002 → 400) if two writes race.
 */
async function resolveSlug(brand: Brand, source: string, excludeId?: string): Promise<string> {
  const prisma = dbFor(brand)
  const base = slugify(source) || 'post'
  let candidate = base
  let n = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.blogPost.findFirst({
      where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return candidate
    candidate = `${base}-${n++}`
  }
}

/**
 * Split the textarea into the String[] body column, on BLANK LINES.
 *
 * Each chunk is one block. Every line inside a chunk is trimmed - a stray indent
 * would otherwise hide the "## " / "> " / "• " marker the renderer keys on - but
 * the newlines BETWEEN those lines survive, which is what keeps a bullet list one
 * block instead of one block per bullet.
 */
const BLANK_LINE = /\r?\n\s*\r?\n/
const NEWLINE = /\r?\n/
const SPLIT_KEYWORDS = /[,\n]/

function splitBody(raw: string): string[] {
  return raw
    .split(BLANK_LINE)
    .map((chunk) =>
      chunk
        .split(NEWLINE)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n'),
    )
    .filter((chunk) => chunk.length > 0)
}

/**
 * The inverse, for the edit page's textarea. Exported because the two halves
 * have to agree: joining with a single newline and splitting on blank lines
 * makes every post one enormous block on the very next save.
 */
export function joinBody(blocks: string[]): string {
  return blocks.join('\n\n')
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** All posts (every status) newest first, each with its category name. */
export async function listPostsAdmin(brand: Brand) {
  const prisma = dbFor(brand)
  try {
    const rows = await prisma.blogPost.findMany({
      orderBy: { publishedAt: 'desc' },
      include: { category: { select: { name: true } } },
    })

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      author: r.author,
      status: r.status,
      featured: r.featured,
      categoryName: r.category.name,
      publishedAt: r.publishedAt,
    }))
  } catch {
    return []
  }
}

/** One post, fully loaded for the editor (includes its category). */
export async function getPostAdmin(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  return prisma.blogPost.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      faqs: { orderBy: { position: 'asc' } },
    },
  })
}

/** Categories for the editor's <select>, alphabetical. */
export async function listCategoriesAdmin(brand: Brand) {
  const prisma = dbFor(brand)
  try {
    return await prisma.blogCategory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  } catch {
    return []
  }
}

// ─────────────────────────────── Writes ─────────────────────────────────

/**
 * Every column both writes set, so a field added to one cannot go missing from
 * the other — which is how `metaTitle` would otherwise end up saveable on create
 * and silently dropped on edit.
 *
 * Empty strings become NULL for the nullable columns: the read service treats
 * NULL as "fall back to the title", and '' would be a third state that renders
 * an empty <title>.
 */
function postColumns(input: BlogPostInput, slug: string) {
  return {
    slug,
    title: input.title,
    categoryId: input.categoryId,
    excerpt: input.excerpt,
    author: input.author,
    readTime: input.readTime,
    tone: input.tone,
    image: input.image || null,
    featured: input.featured,
    status: input.status,
    body: splitBody(input.body),
    // Sanitised HTML overrides `body` at read time. Empty-ish (`<p></p>`,
    // `<p><br></p>`, whitespace) becomes NULL too — Tiptap emits `<p></p>` for
    // a fresh empty editor, and storing that shell hid the `body[]` fallback
    // on every affected post. `isEmptyBlogHtml` catches both cases.
    bodyHtml: (() => {
      const sanitised = sanitizeBlogHtml(input.bodyHtml || '')
      return isEmptyBlogHtml(sanitised) ? null : sanitised
    })(),
    metaTitle: input.metaTitle || null,
    imageAlt: input.imageAlt || null,
    // Legacy `keywords` is written as the union of the three typed lists PLUS
    // anything the caller passed in the legacy field itself. Deduped so the
    // storefront's meta tag never repeats a term. Old readers that only know
    // about `keywords` still see the complete set.
    keywords: dedupeKeywords([
      ...input.keywords,
      ...input.keywordsPrimary,
      ...input.keywordsSecondary,
      ...input.keywordsSemantic,
    ]),
    keywordsPrimary: input.keywordsPrimary,
    keywordsSecondary: input.keywordsSecondary,
    keywordsSemantic: input.keywordsSemantic,
    cta: input.cta || null,
  }
}

/** FAQ rows in the order the editor arranged them. */
function faqRows(input: BlogPostInput) {
  return input.faqs.map((faq, position) => ({
    question: faq.question,
    answer: faq.answer,
    position,
  }))
}

export async function createPost(brand: Brand, input: BlogPostInput) {
  const prisma = dbFor(brand)
  const slug = await resolveSlug(brand, input.slug || input.title)

  return prisma.blogPost.create({
    data: { ...postColumns(input, slug), faqs: { create: faqRows(input) } },
    select: { id: true },
  })
}

export async function updatePost(brand: Brand, id: string, input: BlogPostInput) {
  const prisma = dbFor(brand)
  const slug = await resolveSlug(brand, input.slug || input.title, id)

  // Replaced wholesale rather than diffed: `position` is what orders them, the
  // set is small, and reconciling by index would renumber every row anyway. In
  // ONE transaction, so a failure between the delete and the create cannot leave
  // an article whose FAQ block has vanished but whose FAQPage schema still
  // claims it — the exact mismatch that earns a manual action.
  return prisma.$transaction(async (tx) => {
    await tx.blogPostFaq.deleteMany({ where: { postId: id } })
    return tx.blogPost.update({
      where: { id },
      data: { ...postColumns(input, slug), faqs: { create: faqRows(input) } },
      select: { id: true },
    })
  })
}

/** Hard delete — a post has no order/history dependents, so removal is clean. */
export async function deletePost(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  return prisma.blogPost.delete({ where: { id }, select: { id: true } })
}

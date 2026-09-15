/**
 * Journal reads — backed by the app's own static journal.
 *
 * `src/data/blog.ts` still ships the full set of posts (it predates the move to
 * Postgres and was never deleted, because `CATEGORY_META` is read by the blog
 * components at render time). It has no `@femi9/*` imports of its own, so this
 * stub can source from it directly and the /blog surface shows real articles
 * rather than lorem.
 *
 * `bodyHtml` is deliberately left undefined: the static posts are block arrays,
 * which is exactly the legacy shape `BlogPost.tsx` still renders with <Body>.
 */

import { POSTS, CATEGORIES, type BlogPost } from '../../../src/data/blog'
import type { Brand } from '../../db'

export interface BlogPostDTO {
  slug: string
  title: string
  category: string
  excerpt: string
  author: string
  date: string
  readTime: number
  tone: string
  image?: string
  featured?: boolean
  /** Legacy block lines. Rendered when `bodyHtml` is absent. */
  body: string[]
  /** Sanitised rich HTML from the console's editor. Never set by this stub. */
  bodyHtml?: string
}

export interface BlogCategoryDTO {
  name: string
  slug: string
}

const toDTO = (p: BlogPost): BlogPostDTO => ({
  slug: p.slug,
  title: p.title,
  category: p.category,
  excerpt: p.excerpt,
  author: p.author,
  date: p.date,
  readTime: p.readTime,
  tone: p.tone,
  image: p.image,
  featured: p.featured,
  body: p.body,
})

export async function listPosts(_brand: Brand): Promise<BlogPostDTO[]> {
  return POSTS.map(toDTO)
}

export async function listCategories(_brand: Brand): Promise<BlogCategoryDTO[]> {
  return CATEGORIES.map((name) => ({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  }))
}

export async function getPost(_brand: Brand, slug: string): Promise<BlogPostDTO | null> {
  const found = POSTS.find((p) => p.slug === slug)
  return found ? toDTO(found) : null
}

export async function relatedPosts(
  _brand: Brand,
  slug: string,
  n = 3,
): Promise<BlogPostDTO[]> {
  const post = POSTS.find((p) => p.slug === slug)
  if (!post) return []
  // Same-category first, then anything else, so the strip is never short.
  const sameCat = POSTS.filter((p) => p.slug !== slug && p.category === post.category)
  const others = POSTS.filter((p) => p.slug !== slug && p.category !== post.category)
  return [...sameCat, ...others].slice(0, n).map(toDTO)
}

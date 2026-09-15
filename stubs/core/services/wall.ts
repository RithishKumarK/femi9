/**
 * The Periods Wall — fixture reads, in-memory writes.
 *
 * Writes land in a module-level array so the compose form on /periods-wall
 * actually does something while you are looking at it. They are gone the moment
 * the dev server restarts, and they never touch moderation: the real service
 * holds a new post at `pending` until someone approves it in the console.
 */

import type { Brand } from '../../db'

export interface WallPostDTO {
  id: string
  name: string
  handle: string
  body: string
  product: string
  rating: number
  likeCount: number
  createdAt: string
}

const SEED: WallPostDTO[] = [
  {
    id: 'w1',
    name: 'Divya',
    handle: '@divya.s',
    body:
      'First cycle without a single rash patch. I did not think a pad could change how ' +
      'the week feels, but here we are.',
    product: 'Femi9 290mm Pads (Large)',
    rating: 5,
    likeCount: 42,
    createdAt: '2026-08-30T09:12:00.000Z',
  },
  {
    id: 'w2',
    name: 'Ritika',
    handle: '@ritika.m',
    body: 'Night three, heaviest day, slept seven hours, woke up dry. That is the whole review.',
    product: 'Femi9 330mm Pads (Double Wings)',
    rating: 5,
    likeCount: 31,
    createdAt: '2026-08-22T18:40:00.000Z',
  },
  {
    id: 'w3',
    name: 'Ananya',
    handle: '@ananya.writes',
    body:
      'Switched the whole house over. My mother was sceptical about the anion strip and ' +
      'is now the one reordering.',
    product: 'Femi9 180mm Mini Pads',
    rating: 4,
    likeCount: 18,
    createdAt: '2026-08-11T07:05:00.000Z',
  },
]

/**
 * On `globalThis` for the same reason the cart is: the compose form POSTs to a
 * route handler and the page reads through a server component, and Next builds
 * those into separate bundles. A module-level array would accept the story and
 * then never show it.
 */
const posts: WallPostDTO[] =
  ((globalThis as Record<string, unknown>).__femi9StubWall as WallPostDTO[]) ??
  ((globalThis as Record<string, unknown>).__femi9StubWall = [...SEED])

export async function listApprovedPosts(_brand: Brand): Promise<WallPostDTO[]> {
  return [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function createPost(
  _brand: Brand,
  input: { name?: string; handle?: string; body: string; product?: string; rating?: number },
): Promise<WallPostDTO> {
  const post: WallPostDTO = {
    id: `w${Date.now().toString(36)}`,
    name: input.name?.trim() || 'Anonymous',
    handle: input.handle?.trim() || '@anonymous',
    body: input.body,
    product: input.product?.trim() || 'Femi9',
    rating: input.rating ?? 5,
    likeCount: 0,
    createdAt: new Date().toISOString(),
  }
  posts.unshift(post)
  return post
}

export async function likePost(
  _brand: Brand,
  id: string,
  _userId?: string,
): Promise<{ likeCount: number }> {
  const post = posts.find((p) => p.id === id)
  if (!post) return { likeCount: 0 }
  post.likeCount += 1
  return { likeCount: post.likeCount }
}

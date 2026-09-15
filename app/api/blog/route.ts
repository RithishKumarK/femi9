import { ok, handle } from '@femi9/core/api'
import { listPosts, listCategories } from '@femi9/core/services/blog'

export const dynamic = 'force-dynamic'

/** GET /api/blog — the full blog index: posts + category chips. */
export async function GET() {
  return handle(async () => {
    const [posts, categories] = await Promise.all([listPosts('femi9'), listCategories('femi9')])
    return ok({ posts, categories })
  })
}

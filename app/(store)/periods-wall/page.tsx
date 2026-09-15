import { PeriodsWall } from '@/screens/PeriodsWall'
import { listApprovedPosts } from '@femi9/core/services/wall'

// Server component: approved wall posts are fetched from Postgres and handed to
// the (client) PeriodsWall screen as props. Force-dynamic so a freshly approved
// story shows on the next visit without a stale cache.
export const dynamic = 'force-dynamic'

export default async function PeriodsWallPage() {
  // The compose form remains usable when the read-side database is briefly
  // unavailable; the API will report the write failure explicitly if needed.
  const posts = await listApprovedPosts('femi9').catch(() => [])
  return <PeriodsWall posts={posts} />
}

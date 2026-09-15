'use client'

import { Link } from '@/lib/router-compat'
import { BlogCover } from './BlogCover'
import type { BlogPostDTO } from '@femi9/core/services/blog'

/* `CatChip` used to live here, emitting the .bcat / .bcat--dark pill. Nothing
   ever mounted it — BlogPost.tsx imported it and never rendered it — so it and
   its CSS have been removed rather than left to imply mobile coverage that was
   not there. */

function Meta({ post }: { post: BlogPostDTO }) {
  return (
    <span className="bmeta">
      <b>{post.author}</b>
      <i />
      {post.date}
      <i />
      {post.readTime} min read
    </span>
  )
}

/** Standard editorial card used in the listing grid and "Keep reading". */
export function ArticleCard({
  post,
  coverSizes,
}: {
  post: BlogPostDTO
  /** `sizes` for the cover when the card renders wider than the default grid track. */
  coverSizes?: string
}) {
  return (
    <Link to={`/blog/${post.slug}`} className="bcard interactive">
      <span className="bcard-poster">
        <BlogCover post={post} sizes={coverSizes} />
      </span>
      <span className="bcard-body">
        <h3>{post.title}</h3>
        <p>{post.excerpt}</p>
        <Meta post={post} />
      </span>
    </Link>
  )
}

/** Full-bleed overlay tile used in the featured mosaic. */
export function MosaicTile({
  post,
  big = false,
  priority = false,
}: {
  post: BlogPostDTO
  big?: boolean
  /** The lead tile is the listing's LCP — it must not be fetched lazily. */
  priority?: boolean
}) {
  return (
    <Link to={`/blog/${post.slug}`} className={`mtile interactive ${big ? 'mtile--big' : ''}`}>
      <BlogCover post={post} variant="deep" priority={priority} />
      <span className="mtile-scrim">
        <h3>{post.title}</h3>
        <span className="mtile-read">{post.readTime} min read</span>
      </span>
    </Link>
  )
}

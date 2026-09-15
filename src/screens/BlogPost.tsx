'use client'

import { Link } from '@/lib/router-compat'
import { CATEGORY_META, type BlogCategory } from '../data/blog'
import { ArticleCard } from '../components/BlogCards'
import { BlogCover, optImageBase } from '../components/BlogCover'
import { OptImg } from '@/components/OptImg'
import type { BlogPostDTO } from '@femi9/core/services/blog'

interface Props {
  // Article + related reads are resolved on the server by slug and passed in.
  post: BlogPostDTO
  related: BlogPostDTO[]
}

/* The article body renders at max-width:720px inside .wrap. */
const BODY_IMG_SIZES = '(max-width: 760px) 92vw, 720px'

/** Strips the leading bullet or "1. " marker from a list line. */
const LIST_MARKER = /^\s*(?:•|\d+\.)\s+/

/**
 * Body blocks are stored as single strings, and a list is one string with the
 * items separated by embedded newlines. Rendering that as a <p> let HTML
 * whitespace collapsing eat every separator, so each list came out as one
 * run-on paragraph with bullet characters stranded mid-sentence.
 *
 * The numbered branch deliberately requires an embedded newline as well as the
 * "N. " marker, so an ordinary paragraph opening with a figure ("2026 guidance
 * shows…", "33.1% of young women…") can never be mistaken for a list. The
 * bullet branch needs no such guard — "•" never opens prose.
 */
function listKind(line: string): 'ul' | 'ol' | null {
  if (/^\s*•\s/.test(line)) return 'ul'
  if (line.includes('\n') && /^\s*\d+\.\s/.test(line)) return 'ol'
  return null
}

function Body({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>
        if (line.startsWith('> ')) return <blockquote key={i}>{line.slice(2)}</blockquote>
        if (line.startsWith('![')) {
          const match = line.match(/!\[(.*?)\]\((.*?)\)/)
          if (match) {
            const base = optImageBase(match[2])
            return (
              <figure key={i} className="article-body-img">
                {base ? (
                  <OptImg base={base} sizes={BODY_IMG_SIZES} alt={match[1]} />
                ) : (
                  /* Not in the derivative manifest (an editor-pasted URL, or an
                     asset under the 6 KB ladder threshold). The dimensions still
                     have to be stated or the figure occupies 0px until the bytes
                     arrive and then snaps the article mid-scroll. */
                  <img src={match[2]} alt={match[1]} width={1200} height={750} loading="lazy" decoding="async" />
                )}
                {match[1] && <figcaption>{match[1]}</figcaption>}
              </figure>
            )
          }
        }

        const kind = listKind(line)
        if (kind) {
          const items = line
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.replace(LIST_MARKER, ''))
          const className = kind === 'ol' ? 'article-body-list article-body-list--num' : 'article-body-list'
          return kind === 'ol' ? (
            <ol key={i} className={className}>
              {items.map((li, j) => (
                <li key={j}>{li}</li>
              ))}
            </ol>
          ) : (
            <ul key={i} className={className}>
              {items.map((li, j) => (
                <li key={j}>{li}</li>
              ))}
            </ul>
          )
        }

        return <p key={i}>{line}</p>
      })}
    </>
  )
}

export function BlogPost({ post, related }: Props) {
  // category is a plain string on the DTO; CATEGORY_META is keyed by the known
  // category union, so we narrow it for the colour lookup.
  const { color } = CATEGORY_META[post.category as BlogCategory] ?? { color: '#7B4FA6' }

  return (
    <main className="blog article" id="top">
      <div className="wrap article-top">
        <Link to="/blog" className="article-back">← The Femi9 Journal</Link>
        <div className="article-head">
          <h1 className="display article-title">{post.title}</h1>
          <span className="bmeta article-meta">
            <b>{post.author}</b>
            <i />
            {post.date}
            <i />
            {post.readTime} min read
          </span>
        </div>
      </div>

      <div className="article-cover">
        {/* This is the page's LCP element — it must not be lazy, and it renders
            far wider than a card, so it carries its own sizes. `meet` keeps the
            generated SVG cover letterboxed rather than cropped in a wide box. */}
        <BlogCover
          post={post}
          variant="light"
          className="article-cover-art"
          priority
          sizes="(max-width: 900px) 92vw, 1120px"
          svgFit="meet"
        />
      </div>

      <article className="wrap article-body" style={{ '--accent': color } as React.CSSProperties}>
        {post.bodyHtml ? (
          // Rich HTML from the admin's Tiptap editor. Sanitised server-side
          // in @femi9/core/blog-html on save, so injecting as HTML here is
          // safe (no <script>, no inline event handlers, no off-origin images).
          <div className="article-html" dangerouslySetInnerHTML={{ __html: post.bodyHtml }} />
        ) : (
          // Legacy block-based renderer — still used for posts that predate
          // the rich editor. They render exactly as before.
          <Body lines={post.body} />
        )}
      </article>

      <div className="wrap article-cta">
        <Link to="/shop" className="btn btn-primary">Shop Femi9 pads</Link>
      </div>

      <section className="wrap article-related">
        <h2 className="display">Keep reading</h2>
        <div className="bgrid">
          {related.map((p) => (
            <ArticleCard key={p.slug} post={p} />
          ))}
        </div>
      </section>
    </main>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPost, relatedPosts } from '@femi9/core/services/blog'
import { BlogPost } from '@/screens/BlogPost'

// Per-page SEO: reuse the same loader the page uses, mapping the resolved post
// onto title/description/Open-Graph. Never throws — an unresolved slug gets a
// sensible fallback title (the page itself still renders notFound()).
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const post = await getPost('femi9', params.slug)
  if (!post) return { title: 'Article not found · Femi9' }
  const title = `${post.title} · Femi9`
  const description = post.excerpt
  const images = post.image ? [post.image] : undefined
  return {
    title,
    description,
    openGraph: { title, description, images },
  }
}

// Server component: resolve the article (and its related reads) from Postgres
// by slug, then hand them to the BlogPost screen as props.
export default async function BlogPostPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const post = await getPost('femi9', params.slug)
  if (!post) notFound()
  const related = await relatedPosts('femi9', params.slug, 3)
  return <BlogPost post={post} related={related} />
}

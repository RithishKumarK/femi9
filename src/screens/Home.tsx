'use client'

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Link } from '@/lib/router-compat'
import { CycleTracker } from '@/components/CycleTracker'
import type { ProductWithVariants } from '@femi9/core/services/products'
import type { BlogPostDTO } from '@femi9/core/services/blog'
import { Footer } from '@/components/Footer'
import { Nav } from '@/components/Nav'
import { OptImg } from '@/components/OptImg'
import { optImageBase } from '@/components/BlogCover'
import { ProductCard } from '@/components/ProductCard'
import { CardSwipe, defaultCards, type CardItem } from '@/components/CardSwipe'
import { PadLayersStage } from '@/components/PadLayersStage'
import { rupees } from '@/data/products'
import { VideoTestimonials } from '@/components/VideoTestimonials'
import { ProductMarquee } from '@/components/ProductMarquee'
import { useMediaGate } from '@/components/useMediaGate'
import { CountUp } from '@/components/CountUp'
import '../styles/home-partner.css'

const ASSET = '/assets/figma-home/'

interface Props {
  products: ProductWithVariants[]
  posts: BlogPostDTO[]
}

function Flower({ light = false }: { light?: boolean }) {
  return (
    <span className={`fl-flower${light ? ' fl-flower--light' : ''}`} aria-hidden="true">
      <img src={`${ASSET}about-imgGroup.svg`} alt="" width={16} height={16} loading="lazy" decoding="async" />
    </span>
  )
}

function Reveal({
  children,
  className,
  id,
}: {
  children: ReactNode
  className: string
  id?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setVisible(true)
      return
    }

    const node = ref.current
    if (!node) return
    // Preserve Figma's pointer-entry trigger, but also reveal when a section
    // enters the viewport. Scrolling does not consistently dispatch mouseenter,
    // which otherwise leaves entire desktop sections in their hidden variant.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [id])

  return (
    <section
      ref={ref}
      className={className}
      id={id}
      data-visible={visible ? 'true' : undefined}
      onMouseEnter={() => setVisible(true)}
      onFocusCapture={() => setVisible(true)}
    >
      {children}
    </section>
  )
}

/** How long the product photo has the stage before the hero copy reveals. */
const HERO_WORDS_DELAY_MS = 800

/**
 * Splits a phrase into one span per word for the hero's word-by-word reveal.
 * `from` continues the stagger index across phrases of the same line. The
 * spaces stay real text nodes, so wrapping, text-wrap:balance and the heading's
 * accessible name are unchanged.
 */
function HeroWords({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="fl-hero__word" style={{ '--w': from + i } as CSSProperties}>
            {word}
          </span>
        </Fragment>
      ))}
    </>
  )
}

function Hero() {
  const heroRef = useRef<HTMLElement>(null)

  // Lightweight scroll parallax listener (updates CSS custom property directly)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let ticking = false
    const heroEl = heroRef.current
    if (!heroEl) return

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (!heroEl) return
          const rect = heroEl.getBoundingClientRect()
          const height = rect.height || 800
          if (rect.bottom > 0 && rect.top <= 0) {
            const progress = Math.min(Math.max(-rect.top / height, 0), 1)
            heroEl.style.setProperty('--hero-scroll-progress', progress.toFixed(4))
          } else if (rect.top > 0) {
            heroEl.style.setProperty('--hero-scroll-progress', '0')
          }
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const buyNow = () => document.querySelector('#products')?.scrollIntoView({ behavior: 'smooth' })

  const imgRef = useRef<HTMLImageElement>(null)

  /**
   * Drives the hero entrance (the "product first, then the words" block in
   * figma-landing-responsive.css):
   *   'wait'  - the server HTML; CSS failsafes show everything if this never runs
   *   'image' - as soon as the photo is decoded: the product settles in
   *   'all'   - HERO_WORDS_DELAY_MS later: headline and sub-copy reveal word by word
   * Reduced motion skips straight to 'all'.
   */
  const [reveal, setReveal] = useState<'wait' | 'image' | 'all'>('wait')

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReveal('all')
      return
    }

    const img = imgRef.current
    let cancelled = false
    let wordsTimer = 0
    const showImage = () => {
      if (cancelled) return
      setReveal('image')
      wordsTimer = window.setTimeout(() => {
        if (!cancelled) setReveal('all')
      }, HERO_WORDS_DELAY_MS)
    }

    // A stalled download can only hold the product back 1.5s before it shows anyway.
    const cap = window.setTimeout(showImage, 1500)
    const afterDecode = () => {
      if (cancelled) return
      window.clearTimeout(cap)
      showImage()
    }
    const decodeThenSchedule = () => {
      img?.decode().then(afterDecode, afterDecode)
    }

    if (!img) {
      afterDecode()
    } else if (img.complete) {
      decodeThenSchedule()
    } else {
      img.addEventListener('load', decodeThenSchedule, { once: true })
      img.addEventListener('error', afterDecode, { once: true })
    }

    return () => {
      cancelled = true
      window.clearTimeout(wordsTimer)
      window.clearTimeout(cap)
      img?.removeEventListener('load', decodeThenSchedule)
      img?.removeEventListener('error', afterDecode)
    }
  }, [])

  return (
    <section
      ref={heroRef}
      className="fl-hero fl-hero--fullscreen-studio"
      aria-labelledby="fl-hero-main-heading"
      data-hero-reveal={reveal}
    >
      {/* Full-bleed Studio Product Background Visual */}
      <div className="fl-hero__fullscreen-bg" aria-hidden="true">
        <img
          ref={imgRef}
          src="/assets/img/hero-full-studio.webp"
          alt="Exact studio product display of Femi9 organic sanitary napkin"
          className="fl-hero__fullscreen-img"
          width={1672}
          height={940}
          decoding="async"
          fetchPriority="high"
        />
        <div className="fl-hero__gradient-overlay" />
      </div>

      <div className="fl-shell fl-hero__inner">
        {/* LEFT COLUMN: Headline, Subtext, Buy Now CTA, Trust Badges */}
        <div className="fl-hero__copy">
          <h1 id="fl-hero-main-heading" className="fl-hero__title">
            <span><HeroWords text="Made For Comfort," /></span>{' '}
            <span><HeroWords text="Designed For Everyday Confidence" from={3} /></span>
          </h1>
          <p className="fl-hero__subtitle">
            <span><HeroWords text="Softness You Can Feel." /></span>{' '}
            <span><HeroWords text="Confidence You Can Carry." from={4} /></span>
          </p>
          <div className="fl-hero__actions">
            <button type="button" className="fl-btn fl-btn--gold fl-hero__cta" onClick={buyNow}>
              Buy Now
            </button>
          </div>
          <div className="fl-hero__proof">
            <span>
              <img src={`${ASSET}hero-imgBadgetCheckAlt21.png`} alt="" width={22} height={22} loading="lazy" decoding="async" />
              Certified Organic Cotton
            </span>
            <span className="fl-hero__proof-divider" aria-hidden="true">|</span>
            <span>
              <img src={`${ASSET}hero-imgSeedling1.png`} alt="" width={22} height={22} loading="lazy" decoding="async" />
              Biodegradable
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: Empty overlay spacing so full studio product imagery shines */}
        <div className="fl-hero__visual-focal" aria-hidden="true" />
      </div>
    </section>
  )
}



const BENEFITS = [
  { image: 'figma-home/why-imgImage23', art: 'comfort', title: 'Cotton-Soft Comfort', copy: 'A gentle, soft surface that feels nice against your skin throughout your period.' },
  { image: 'figma-home/why-imgImage24', art: 'breathable', title: 'Breathable Design', copy: 'Airflow-friendly layers that help reduce trapped heat and keep you fresher, longer.' },
  { image: 'figma-home/why-imgImage25', art: 'anion', title: 'Reliable Absorbency & Leak Protection', copy: 'Designed to absorb quickly and keep you protected through regular and heavier flow days.' },
  { image: 'figma-home/why-imgImage26', art: 'clean', title: 'Rash-Conscious Comfort', copy: 'Thoughtfully made for women who want gentle, comfortable pads without unnecessary irritants.' },
  { image: 'figma-home/why-imgImage25', art: 'anion', title: 'Freshness & Odour Control', copy: 'Stay feeling fresh and confident, whether you\'re at work, traveling, or resting.' },
  { image: 'figma-home/why-imgImage26', art: 'clean', title: 'Made for Everyday Movement', copy: 'A lightweight fit that supports freedom of movement-focus on your day, not your pad.' },
] as const

function Why() {
  return (
    <Reveal className="fl-why" id="why">
      <div className="fl-shell">
        <div className="fl-heading fl-heading--light">
          <div><p className="fl-kicker">Why Femi9 <Flower light /></p><h2>Built With Care.<br />Designed For Your Comfort.</h2><p>Made To Support Your Comfort, Your Health, And Your Everyday Well-Being.</p></div>
          <Link className="fl-btn fl-btn--light" to="/periods-wall">View Details <span>→</span></Link>
        </div>
      </div>
      {/* Scroll story. The track is tall; the pin inside it sticks for the
          track's length. PadLayersStage reads progress from `[data-why-story]`
          and exposes it as --why-p: the pad video scrubs against it on the
          right, and the benefits take turns on the left, one per equal stretch
          of scroll (--why-n). Scrolling back replays both. */}
      <div
        className="fl-why__story"
        data-why-story
        style={{ '--why-n': BENEFITS.length } as CSSProperties}
      >
        <div className="fl-why__pin">
          <div className="fl-shell">
            <div className="fl-why__layout">
              <div className="fl-why__copy">
                <p className="fl-why__eyebrow">Designed For Your Comfort</p>
                <div className="fl-why__steps">
                  {BENEFITS.map((item, i) => (
                    <article
                      key={item.title}
                      className="fl-why__step"
                      style={{ '--i': i } as CSSProperties}
                    >
                      <span className={`fl-benefit__art fl-benefit__art--${item.art}`} aria-hidden="true">
                        {/* The art is blown up to 219-244% of its box by the crop rules, so the
                            rendered width is roughly 2.4x the visible chip. */}
                        <OptImg base={item.image} sizes="(max-width: 620px) 200px, (max-width: 900px) 250px, 340px" alt="" />
                      </span>
                      <div className="fl-why__text">
                        <p className="fl-why__count">Benefit {i + 1} of {BENEFITS.length}</p>
                        <h3>
                          {item.title.slice(0, item.title.lastIndexOf(' '))}{' '}
                          <span className="fl-why__script">{item.title.slice(item.title.lastIndexOf(' ') + 1)}</span>
                        </h3>
                        <p>{item.copy}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="fl-why__dots" aria-hidden="true">
                  {BENEFITS.map((item, i) => (
                    <i key={item.title} style={{ '--i': i } as CSSProperties} />
                  ))}
                </div>
              </div>
              <div className="fl-why__product">
                <PadLayersStage />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  )
}

/**
 * How many cards the featured rail is laid out for.
 *
 * The authority is `brandConfig('femi9').featuredSlots` in @femi9/core/brands,
 * which is what the console enforces and what `listFeaturedProducts` takes. It
 * is repeated here rather than imported because this screen is a CLIENT
 * component and that module reaches `@femi9/db` — importing it would pull the
 * Prisma client into the browser bundle. Keep the two in step; the grid's
 * column counts in components/Products.css are the third place this number
 * shows up.
 */
const FEATURED_SLOTS = 5

function ProductGrid({ products }: { products: ProductWithVariants[] }) {
  // Map database products to CardItem or fallback to default cards
  const swipeCards: CardItem[] =
    products && products.length > 0
      ? products.map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: p.flow ? `${p.flow} Protection` : 'Organic Cotton Care',
          desc: p.desc || 'Doctor-formulated organic sanitary pad designed for gentle skin care and absorbency.',
          category: p.type === 'panty' ? 'Overnight' : 'Sanitary Pads',
          price: rupees(p.price),
          img: p.img || '/assets/opt/img/sample-640.webp',
          tag: p.tag,
          flow: p.flow,
          meta: p.meta || '10 Pads / Pack',
          badge: p.tag || (p.type === 'panty' ? '360° Fit' : 'Organic'),
        }))
      : defaultCards

  const handleBuyNow = (card: CardItem) => {
    // Navigate to product detail or trigger purchase
    const id = card.id
    if (id) {
      window.location.href = `/product/${id}`
    }
  }

  return (
    <Reveal className="fl-products" id="products">
      <img className="fl-products__ribbon" src={`${ASSET}products-imgRectangle15.svg`} alt="" width={1548} height={278} loading="lazy" decoding="async" />
      <div className="fl-shell">
        {/* Comfort-first heading, centred: one label, one headline, one
            supporting line. The section-level "Explore All" follows the carousel
            (styles: craft-home.css, "Product discovery"). */}
        <div className="fl-heading fl-heading--discovery">
          <div>
            <p className="fl-kicker fl-kicker--gold">Your Comfort, Your Choice</p>
            <h2>Comfort That Moves With You.</h2>
            <p className="fl-products__lede">
              From everyday comfort to extra protection, find the Femi9 pad that fits your flow.
            </p>
          </div>
        </div>
        
        {/* Premium 4-Card Drag & Swipe Carousel */}
        <div style={{ marginTop: 28 }}>
          <CardSwipe cards={swipeCards} onBuyNow={handleBuyNow} />
        </div>

        <div className="fl-products__explore">
          <Link className="fl-btn fl-btn--outline fl-btn--arrow" to="/shop">Explore All <span>→</span></Link>
        </div>
      </div>
    </Reveal>
  )
}

const JOURNAL = [
  { tag: 'Menstrual Health', title: '5 Signs Your Period Is Trying To Tell You Something', pos: 'left' },
  { tag: 'Wellness', title: 'Foods That Naturally Help Reduce Period Cramps', pos: 'center' },
  { tag: 'Self Care', title: 'Simple Night-Time Habits For Better Period Sleep', pos: 'right' },
] as const

function Journal({ posts }: { posts: BlogPostDTO[] }) {
  return (
    <Reveal className="fl-journal" id="journal">
      <img className="fl-journal__ribbon" src={`${ASSET}blogs-imgVector2.svg`} alt="" width={844} height={425} loading="lazy" decoding="async" />
      <img className="fl-journal__polygon" src={`${ASSET}blogs-imgPolygon2.svg`} alt="" width={185} height={185} loading="lazy" decoding="async" />
      <div className="fl-shell">
        <div className="fl-heading">
          <div><p className="fl-kicker">Blogs <Flower /></p><h2>Period Care, Explained Simply</h2><p>Knowledge, Care, And Confidence - Everything You Need To Understand Your Body Better.</p></div>
          <Link className="fl-btn fl-btn--outline" to="/blog">View All</Link>
        </div>
        <div className="fl-journal__grid">
          {/* The thread the three notes hang from (desktop). Decorative, and
              out of grid flow — it is absolutely positioned. */}
          <svg className="fl-journal__thread" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path
              d="M -20 6 C 60 10, 110 22, 158 24 C 270 30, 390 40, 500 24 C 610 40, 730 30, 841 24 C 890 22, 940 10, 1020 6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {JOURNAL.map((item, index) => {
            const post = posts[index]
            return (
            <div className="fl-journal__note" key={post?.slug ?? item.title}>
            <span className="fl-journal__pin" aria-hidden="true" />
            <Link className="fl-blog" to={post ? `/blog/${post.slug}` : '/blog'} style={{ '--blog-index': index } as CSSProperties}>
              <span className={`fl-blog__photo ${post?.image ? 'fl-blog__photo--dynamic' : `fl-blog__photo--${item.pos}`}`}>
                {(() => {
                  // Prefer the pre-built WebP ladder when the cover lives under
                  // /assets/img/blogs/… — those raw PNGs are excluded from the
                  // Docker image (see .dockerignore), so a plain <img src=…>
                  // 404s in production. `optImageBase` returns null for an
                  // editor-supplied absolute URL, and then we fall back to a
                  // reservation-only <img> so the layout stays.
                  const base = post?.image ? optImageBase(post.image) : null
                  if (base) {
                    return <OptImg base={base} sizes="(max-width: 900px) 92vw, 1350px" alt="" />
                  }
                  if (post?.image) {
                    return <img src={post.image} alt="" width={1536} height={1024} loading="lazy" decoding="async" />
                  }
                  // No cover set — fall back to the Figma placeholder that ships
                  // with the home page. Desktop crop scales it to ~313% of the
                  // card, hence the deliberately large non-mobile `sizes`.
                  return <OptImg base="figma-home/blogs-imgImage18" sizes="(max-width: 900px) 92vw, 1350px" alt="" />
                })()}
              </span>
              <span className="fl-blog__shade" />
              <span className="fl-blog__meta">
                <span className="fl-blog__read">
                  <small>{post ? `${post.readTime} min read` : '5 min read'}</small>
                  <span className="fl-blog__arrow"><img src={`${ASSET}blogs-imgFrame.svg`} alt="" width={30} height={30} loading="lazy" decoding="async" /></span>
                </span>
              </span>
              <h3>{post?.title ?? item.title}</h3>
            </Link>
            </div>
            )
          })}
        </div>
      </div>
    </Reveal>
  )
}

/**
 * Testimonial section.
 *
 * This was a marquee of stock portraits, each with a decorative play glyph
 * pasted over it and an approved-review quote underneath — a play button that
 * could not be played. It is real customer video now: the same centre-focused
 * rail the product page uses, where the clip in the middle runs to its end and
 * then hands over to the next one.
 *
 * The written reviews it used to pull from the database are not carried over.
 * The clips are six named people speaking for themselves, and captioning one of
 * their faces with a different customer's words would be attributing a quote to
 * the wrong person. The review list still lives on the product page, which is
 * where a shopper is deciding and where it does the most work.
 */
function Testimonials() {
  return (
    <Reveal className="fl-testimonials fl-testimonials--video" id="testimonials">
      <div className="fl-shell">
        <div className="fl-heading">
          <div><p className="fl-kicker fl-kicker--gold">Testimonial <Flower /></p><h2>Real Period Stories. Real Everyday Confidence.</h2></div>
        </div>
        {/* The section supplies its own Figma-typed heading, so the rail is
            asked not to draw one of its own. */}
        <VideoTestimonials heading={null} subhead={null} />
      </div>
    </Reveal>
  )
}

/** [figure, label] — rendered as a <dl>, figure first visually. */
const PARTNER_STATS: [string, string][] = [
  ['5,000+', 'Women Entrepreneurs'],
  ['12', 'Districts Across Tamil Nadu'],
  ['Rs.8,000+', 'Average Monthly Earning'],
  ['100%', 'Flexible Hours'],
]

/** Decorative icon per stat (same order as PARTNER_STATS), in the blue disc. */
const PARTNER_ICONS: ReactNode[] = [
  <svg key="people" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M15.6 14.5c2.3.2 4.1 1.8 4.7 4.5" />
  </svg>,
  <svg key="pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>,
  <svg key="rupee" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 5h10M7 9h10" />
    <path d="M9.5 5c3.6 0 5.2 1.6 5.2 4s-1.8 4-5.2 4H7l7.5 7" />
  </svg>,
  <svg key="clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>,
]

function PartnerArrow() {
  return (
    <svg className="f9-partner__arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Styling: src/styles/home-partner.css (its own `.f9-partner` block). */
function Partner() {
  return (
    <Reveal className="f9-partner" id="opportunities">
      <div className="f9-partner__layout">
        <div className="f9-partner__copy">
          <h2 className="f9-partner__title">Turn Better Periods Into Your Livelihood</h2>
          <p className="f9-partner__lede">Join 5,000+ Women Across Tamil Nadu Earning A Real Income By Bringing Trusted, Organic Period Care To The People They Already Know.</p>
          {/* Two buttons, two labels, two destinations. Both used to land on
              /partner's top — so "How It Works" and "Become A Partner" were the
              same click, and the second one made the first look broken. The
              partner page carries #how and #apply for exactly this. */}
          <div className="f9-partner__actions">
            <Link className="f9-partner__cta" to="/partner#apply">
              Become A Partner
              <PartnerArrow />
            </Link>
            <Link className="f9-partner__link" to="/partner#how">
              How It Works
              <PartnerArrow />
            </Link>
          </div>
        </div>
        {/* The stats take the right-hand column; each figure counts up once. */}
        <dl className="f9-partner__stats">
          {PARTNER_STATS.map(([figure, label], i) => (
            <div className="f9-partner__stat" key={label} style={{ '--i': i } as CSSProperties}>
              <dt>
                <span className="f9-partner__icon" aria-hidden="true">{PARTNER_ICONS[i]}</span>
                {label}
              </dt>
              <dd><CountUp value={figure} delay={250 + i * 140} /></dd>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  )
}

export function Home({ products, posts }: Props) {
  return (
    <main className="figma-landing" id="top">
      <Nav />
      <Hero />
      <ProductMarquee />
      <ProductGrid products={products} />
      <Why />
      {/* Styling lives in figma-landing-responsive.css. It was an inline style
          object on every element here, which outranks any media query, so this
          was the one landing section that kept 80px of desktop padding and a
          35px heading at 360px. */}
      <section id="about-femi9" className="about-section">
        <div className="fl-shell">
          <h2>Designed for Her. Driven by Care. Made to Move With Her.</h2>
          <p>
            Femi9 was created with one simple purpose: to make period care more comfortable, thoughtful, and reliable. We design our sanitary pads around what real women need-softness against your skin, breathable comfort that actually works, absorbency you can count on, and protection you can trust.
          </p>
          <p>
            Beyond just products, Femi9 is about encouraging better menstrual hygiene choices, building awareness, and giving women the confidence they deserve throughout their cycle.
          </p>
          <Link to="/about" className="fl-btn fl-btn--gold">
            Know More About Femi9
          </Link>
        </div>
      </section>
      <Journal posts={posts} />
      <div className="fl-cycle"><CycleTracker /></div>
      <Testimonials />
      <Partner />
      <Footer />
    </main>
  )
}

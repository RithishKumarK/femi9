'use client'

import '../styles/product-detail-extras.css'
import '../styles/craft-product.css'
import '../styles/pdp-key-benefits.css'
import '../styles/pdp-reviews.css'
import '../styles/pdp-motion.css'
// Last of the PDP sheets: the buy block's Lumi9 layout has to outrank both
// app.css and craft-product.css, and does it on scope rather than !important.
import '../styles/pdp-buybox.css'
// The sliding gallery + segmented pickers; after buybox so it has the last word.
import '../styles/pdp-configurator.css'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useRouter } from '@/lib/router-compat'
import { rupees, CADENCES } from '../data/products'
import { useCart } from '../store/cart'
import { PantyArt } from '../components/PantyArt'
import { Bag, Drop, Leaf, ShieldCheck, Check, Close, Facebook, Whatsapp } from '../components/Icons'
import { ICopy, IStar } from '../components/AppIcons'
import { KeyBenefits } from '@/components/KeyBenefits'
import { ProductReviews } from '@/components/ProductReviews'
import { VideoTestimonials } from '@/components/VideoTestimonials'
import type { OptImageBase } from '@/lib/opt-images'
import type { ProductWithVariants, ProductReview } from '@femi9/core/services/products'
import type { ProductExtra } from '@/data/productDetail'
import type { SizeOption } from '@/lib/size-run'
import { usePublicSettings } from '@/lib/use-public-settings'
import { useAddPulse } from '@/lib/use-add-pulse'
import { track } from '@/lib/track'
import { authorizeMandate, type MandateAuthorization } from '@/lib/mandate'

interface Props {
  product: ProductWithVariants
  extra: ProductExtra
  reviews: ProductReview[]
  relatedProducts: ProductWithVariants[]
  /** Every pad length on offer, shortest first. Empty when there is only one. */
  sizeOptions: SizeOption[]
  /** `?size=` off the URL — period underwear only; pads carry size in the path. */
  initialSize?: string
}

const featIcons = [Drop, Leaf, ShieldCheck]

const rvInput: CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: 'var(--surface)',
  color: 'var(--ink)',
  font: 'inherit',
  // Must stay >= 16px. iOS Safari zooms the visual viewport in on focus for any
  // control below that and never zooms back out on blur; because this is an
  // inline style no breakpoint could have rescued it.
  fontSize: '16px',
}

function Stars({ rating }: { rating: number }) {
  // Five bare <svg>s used to be announced as five unlabelled graphics. role=img
  // + a label makes the group a single leaf that reads the rating once — which
  // matters most on the review cards, where the stars are the only place that
  // review's score appears.
  return (
    <span className="stars" role="img" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <IStar key={i} style={{ opacity: i < Math.round(rating) ? 1 : 0.24 }} />
      ))}
    </span>
  )
}

/**
 * The reveal-on-hover add button on a "frequently bought together" card.
 *
 * Its own component, declared at module scope, so each card owns an independent
 * pulse: one `useAddPulse` shared across the mapped strip would flash all four
 * cards every time any one of them was pressed. Module scope rather than nested
 * inside ProductDetail so it keeps its identity between renders and React does
 * not remount (and so reset) every card's state on each parent update.
 */
function RelatedQuickAdd({ name, onAdd }: { name: string; onAdd: () => void | Promise<void> }) {
  const [pulsing, pulse] = useAddPulse()
  return (
    <button
      type="button"
      className={`related-quick-add${pulsing ? ' is-added' : ''}`}
      onClick={() => {
        pulse()
        void onAdd()
      }}
      aria-label={`Add ${name} to bag`}
    >
      Add to cart
    </button>
  )
}

function deliveryDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * The product page last shown in this tab. Module scope, so it survives the
 * client-side route change between sibling sizes and the new pack can slide in
 * from the side of the size run it came from. It is null after a full page
 * load, where the server already painted the stage and an entrance would only
 * be a flash — which also keeps the first client render identical to the HTML.
 */
let lastViewed: { id: string; mm: number } | null = null

function enterDirection(id: string, mm: number): 'from-left' | 'from-right' | null {
  if (!lastViewed || lastViewed.id === id) return null
  return mm >= lastViewed.mm ? 'from-right' : 'from-left'
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * A segmented track with a white pill that slides under the active option.
 *
 * Options mark themselves with `data-slide-item`; the pill is positioned from
 * the active one's measured box rather than from `index / count`, because the
 * options are content-sized and the track scrolls sideways once they overflow.
 * The pill's transition is switched on only after its first placement, so on
 * load it appears in place instead of sweeping in from the left edge.
 */
function SlideTrack({
  active,
  label,
  className,
  children,
}: {
  active: number
  label: string
  className?: string
  children: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  const [thumb, setThumb] = useState({ x: 0, w: 0 })
  const [live, setLive] = useState(false)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const activeItem = () => track.querySelectorAll<HTMLElement>('[data-slide-item]')[active]

    const measure = () => {
      const item = activeItem()
      if (item) setThumb({ x: item.offsetLeft, w: item.offsetWidth })
    }
    measure()

    // Keep the chosen option in view when the row overflows.
    const item = activeItem()
    if (item && track.scrollWidth > track.clientWidth) {
      track.scrollTo({
        left: item.offsetLeft - (track.clientWidth - item.offsetWidth) / 2,
        behavior: placed.current ? 'smooth' : 'auto',
      })
    }

    let raf = 0
    if (!placed.current) {
      placed.current = true
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setLive(true))
      })
    }

    const ro = new ResizeObserver(measure)
    ro.observe(track)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [active])

  return (
    <div
      ref={trackRef}
      className={`pdp-slider-track${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
    >
      <span
        className={`pdp-slider-thumb${live ? ' is-live' : ''}`}
        style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w, opacity: thumb.w ? 1 : 0 }}
        aria-hidden="true"
      />
      {children}
    </div>
  )
}

export function ProductDetail({ product, extra, reviews, relatedProducts, sizeOptions, initialSize }: Props) {
  const { subscribeSavePct } = usePublicSettings()
  const [imgIdx, setImgIdx] = useState(0)
  const [qty, setQty] = useState(1)
  const [packIdx, setPackIdx] = useState<number>((product.packs?.length ?? 1) - 1)
  /* Period underwear reads its size from `?size=`, resolved on the SERVER so a
     shared link renders on the right size instead of correcting itself after
     hydration. An unrecognised value falls back to the second size rather than
     to none — an unknown query string must not leave the picker unselected. */
  const sizeFromUrl = product.sizes?.findIndex((s) => s.toLowerCase() === initialSize?.toLowerCase()) ?? -1
  const [sizeIdx, setSizeIdx] = useState(sizeFromUrl >= 0 ? sizeFromUrl : 1)
  const [mode, setMode] = useState<'once' | 'sub'>('once')
  const [cadence, setCadence] = useState(CADENCES[0].id)
  /* Held across the whole two-phase subscribe (create plan → authorise mandate),
     because the Razorpay sheet is a real wait and a second tap behind it would
     create a SECOND plan she would then be debited for twice. */
  const [subBusy, setSubBusy] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [specsOpen, setSpecsOpen] = useState(true)
  const [reviewsOpen, setReviewsOpen] = useState(true)
  const { add, openCart, notify } = useCart()
  const router = useRouter()

  const [rvName, setRvName] = useState('')
  const [rvPlace, setRvPlace] = useState('')
  const [rvTitle, setRvTitle] = useState('')
  const [rvBody, setRvBody] = useState('')
  const [rvRating, setRvRating] = useState(5)
  const [rvState, setRvState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  /** Confirmation pulse for the main CTA. Shared by the inline button and the
   *  sticky mobile bar, because they are the same action — whichever one the
   *  shopper pressed, the other is either off-screen or the same control. */
  const [ctaPulsing, ctaPulse] = useAddPulse()

  /** The modal serves both jobs; `rvMode` decides which form it shows. */
  const [rvMode, setRvMode] = useState<'review' | 'question'>('review')
  const [qEmail, setQEmail] = useState('')

  const isPanty = product.type === 'panty'
  const packs = product.packs
  const related = relatedProducts
  const mmPart = product.meta.split('·').pop()?.trim() ?? ''
  const selectedPack = packs ? packs[packIdx] : null
  const basePrice = selectedPack ? selectedPack.price : product.price
  const subscriptionPrice = Math.round(basePrice * (100 - subscribeSavePct) / 100)
  const effPrice = mode === 'sub' ? subscriptionPrice : basePrice
  const activeCadence = CADENCES.find((c) => c.id === cadence) ?? CADENCES[0]
  const averageRating = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : extra.rating
  const reviewTotal = reviews.length || extra.reviews
  const shortDescription = extra.long || product.desc

  /* SIZE SLIDER — the pill moves the moment a size is tapped, before the
     sibling product's route has loaded, so the animation never waits on the
     network. The pending choice clears once the new product arrives. */
  const [pendingSize, setPendingSize] = useState<string | null>(null)
  useEffect(() => setPendingSize(null), [product.id])
  const activeSizeIdx = Math.max(0, sizeOptions.findIndex((o) => o.slug === (pendingSize ?? product.id)))
  const maxMm = Math.max(1, ...sizeOptions.map((o) => o.mm))
  const currentMm = sizeOptions.find((o) => o.slug === product.id)?.mm ?? 0

  /* GALLERY SLIDER — swipe/drag state, and the entrance after a size switch. */
  const galleryCount = extra.gallery.length
  const [drag, setDrag] = useState<{ startX: number; dx: number } | null>(null)
  const dragMoved = useRef(false)
  const [stageEnter, setStageEnter] = useState(() => enterDirection(product.id, currentMm))
  useEffect(() => {
    const dir = enterDirection(product.id, currentMm)
    if (dir) {
      setStageEnter(dir)
      setImgIdx(0)
    }
    lastViewed = { id: product.id, mm: currentMm }
  }, [product.id, currentMm])

  const goImg = (i: number) => setImgIdx(Math.min(galleryCount - 1, Math.max(0, i)))

  const endDrag = () => {
    if (!drag) return
    if (drag.dx < -50) goImg(imgIdx + 1)
    else if (drag.dx > 50) goImg(imgIdx - 1)
    setDrag(null)
  }

  /* Rubber-band at either end, so a drag past the last photo still gives. */
  const atEdge = (drag?.dx ?? 0) > 0 ? imgIdx === 0 : imgIdx === galleryCount - 1
  const dragPx = drag ? (atEdge ? drag.dx / 3 : drag.dx) : 0

  /** Lowest price per pad, so the cheapest-per-pad pack can be flagged. */
  const bestPackIdx = packs && packs.length > 1
    ? packs.reduce((best, pk, i) => (pk.price / pk.count < packs[best].price / packs[best].count ? i : best), 0)
    : -1
  const perPad = (price: number, count: number) => rupees(Math.round((price / count) * 10) / 10)

  /**
   * The centrepiece of the Key Benefits figure — a CLEAN pack shot per product.
   *
   * Deliberately not `img/330mm` / `img/290mm`: those two are the old
   * pre-rendered benefit banners, with the very same six claims baked into the
   * pixels. Putting one at the centre of a section that prints those claims as
   * live text around it made every benefit appear twice, once unreadable to
   * assistive tech. These are the plain product photographs instead.
   *
   * A product with no mapping falls back to its own catalog photo, which is
   * DB-authored and therefore has no manifest entry to hang a WebP ladder off.
   */
  const BENEFIT_SHOTS: Record<string, OptImageBase> = {
    p330dw: 'img/prod-330-double',
    p330cw: 'img/prod-330-centre',
    p290l9: 'img/prod-290-large9',
    p290l3: 'img/prod-290-large3',
  }
  const benefitsBase: OptImageBase | null = BENEFIT_SHOTS[product.id] ?? null

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 620px)').matches
    setSpecsOpen(!isMobile)
    setReviewsOpen(!isMobile)
  }, [])

  // /api/events existed with zero instrumentation — not a single storefront
  // interaction was ever recorded. A product view is the cheapest useful signal.
  useEffect(() => {
    track('product_view', { slug: product.id, name: product.name })
  }, [product.id, product.name])

  /**
   * Absolute URL for this product, for the share intents.
   *
   * The first render has to match the server's HTML, so it starts from
   * NEXT_PUBLIC_SITE_URL (inlined identically into both bundles). Reading
   * `window.location` during render made the client build a different href
   * whenever the shopper's host differed from the configured site URL, and
   * React refused to hydrate the share links. After hydration it switches to
   * the origin actually in the address bar, as before.
   */
  const [shareOrigin, setShareOrigin] = useState(process.env.NEXT_PUBLIC_SITE_URL ?? '')
  useEffect(() => {
    setShareOrigin(window.location.origin)
  }, [])
  const shareUrl = `${shareOrigin}/product/${product.id}`

  /**
   * Pick a period-underwear size, and put it in the URL.
   *
   * The pads do this by navigating between sibling products — each length is
   * its own route — but underwear is one product with four variants, so the
   * size goes in the query string instead. `replace` rather than `push`, so a
   * shopper trying all four sizes does not have to press Back four times to
   * leave the page; `scroll: false`, so the choice does not throw her back to
   * the top of the page she is reading.
   */
  const selectSize = (index: number) => {
    setSizeIdx(index)
    const size = product.sizes?.[index]
    if (!size) return
    router.replace(`/product/${product.id}?size=${encodeURIComponent(size)}`, { scroll: false })
  }

  /** The size slider's arrows — the same navigation the chips perform. */
  const stepSize = (delta: number) => {
    const next = sizeOptions[activeSizeIdx + delta]
    if (!next) return
    setPendingSize(next.slug)
    router.push(`/product/${next.slug}`, { scroll: false })
  }

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      notify('Link copied')
    } catch {
      notify('Copying is blocked in this browser')
    }
  }

  /** Open the review form. Signed-out visitors are sent to sign in first — the
   *  endpoint requires a session and would otherwise fail after they had typed. */
  const openReviewForm = () => {
    setRvMode('review')
    setReviewOpen(true)
    setRvState('idle')
  }

  /** Open the same modal on its question form. The answer comes back by email,
   *  so this collects an address rather than a rating. */
  const askQuestion = () => {
    setRvMode('question')
    setReviewOpen(true)
    setRvState('idle')
  }

  /** The cheapest in-stock variant of a related product, mirroring ProductCard. */
  const defaultVariantOf = (p: ProductWithVariants) =>
    p.variants.find((v) => v.stock > 0) ?? p.variants[0]

  const addRelated = async (p: ProductWithVariants) => {
    const variant = defaultVariantOf(p)
    if (!variant) {
      notify('Sorry, that option is currently unavailable')
      return
    }
    await add(variant.id, 1)
    track('add_to_cart', { slug: p.id, variantId: variant.id, qty: 1 })
    openCart()
  }

  const submitReview = async (e: FormEvent) => {
    e.preventDefault()
    if (rvState === 'sending') return
    setRvState('sending')
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productSlug: product.id,
          name: rvName.trim(),
          place: rvPlace.trim() || undefined,
          title: rvTitle.trim() || undefined,
          rating: rvRating,
          body: rvBody.trim(),
        }),
      })
      if (res.status === 401) {
        // The endpoint needs a session. Send her to sign in and bring her back
        // here rather than showing a generic failure after she typed a review.
        router.push(`/login?next=/product/${product.id}`)
        return
      }
      if (!res.ok) throw new Error(`review submit failed: ${res.status}`)
      setRvState('sent')
      track('review_submitted', { slug: product.id, rating: rvRating })
    } catch {
      setRvState('error')
    }
  }

  /** Send a product question to support. No session required — needing an
   *  account to ask a question would simply lose the question. */
  const submitQuestion = async (e: FormEvent) => {
    e.preventDefault()
    if (rvState === 'sending') return
    setRvState('sending')
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productSlug: product.id,
          name: rvName.trim(),
          email: qEmail.trim(),
          question: rvBody.trim(),
        }),
      })
      if (!res.ok) throw new Error(`question submit failed: ${res.status}`)
      setRvState('sent')
      track('question_submitted', { slug: product.id })
    } catch {
      setRvState('error')
    }
  }

  const submit = async () => {
    const variant = isPanty
      ? product.variants.find((v) => v.kind === 'size' && v.size === product.sizes?.[sizeIdx])
      : product.variants.find((v) => v.kind === 'pack' && v.packCount === selectedPack?.count)
    if (!variant) {
      notify('Sorry, that option is currently unavailable')
      return
    }

    if (mode === 'sub') {
      // Two phases, and the second one is what makes this a subscription.
      // The POST creates the plan and the Razorpay mandate but authorises
      // nothing; until her bank approves it below, nothing will ever be
      // debited. Reporting "Subscription started" off the back of the POST
      // alone — which is what this used to do — told her she was subscribed
      // when no payment method had been agreed at all.
      if (subBusy) return
      setSubBusy(true)
      try {
        const res = await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantId: variant.id, qty, cadenceCode: cadence }),
        })
        if (res.status === 401) {
          router.push(`/login?next=/product/${product.id}`)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          notify(body?.error ?? 'Sorry, we could not start your subscription')
          return
        }
        const { authorization } = (await res.json()) as {
          authorization: MandateAuthorization
        }

        const outcome = await authorizeMandate(authorization, {
          description: `${product.name} · ${CADENCES.find((c) => c.id === cadence)?.label ?? ''}`,
        })
        if (outcome.ok) {
          notify(`Subscription started · ${product.name}`)
          router.push('/account?tab=subscriptions')
          return
        }
        // Dismissed is not a failure: the plan is saved and unauthorised, and
        // the account page offers to finish it. Say that rather than nothing,
        // so she is not left wondering whether the tap registered.
        notify(
          outcome.dismissed
            ? 'Saved — finish setting up auto-pay from your account'
            : outcome.message,
        )
      } catch {
        notify('Sorry, we could not start your subscription')
      } finally {
        setSubBusy(false)
      }
      return
    }

    void add(variant.id, qty)
    ctaPulse()
    track('add_to_cart', { slug: product.id, variantId: variant.id, qty })
    openCart()
  }

  const renderGalleryImage = (full = false) => (
    isPanty ? (
      <PantyArt variant={extra.gallery[imgIdx] as 'lilac' | 'plum' | 'gold'} />
    ) : (
      // Gallery URLs are DB-authored, so there is no manifest entry to hang an
      // OptImg ladder off. No width/height here on purpose: both the stage and
      // the fullscreen card size this image entirely from CSS, and the
      // fullscreen card sets only `width`, so a height attribute would become
      // the used height and letterbox it. This is the page's LCP image, hence
      // eager (the default) with a high fetch priority rather than lazy.
      <img
        src={extra.gallery[imgIdx]}
        alt={full ? `${product.name} enlarged` : product.name}
        decoding="async"
        fetchPriority={full ? undefined : 'high'}
      />
    )
  )

  return (
    <div className="pdp-page">
      <main className="pdp-main-content">
        <div className="wrap">
          {/* BREADCRUMB */}
          <div className="crumbs">
            <Link to="/">Home</Link> / <Link to="/shop">Shop</Link> / {product.name}
          </div>

          {/* 3. TWO-COLUMN PRODUCT LAYOUT

              `data-no-reveal` opts the whole buy block out of ScrollMotion's
              automatic block pass. It contains the sticky gallery column, and a
              translateY on an ancestor makes that ancestor the containing block
              — which un-sticks the gallery for the length of the entrance. The
              rows inside opt back in individually with `data-reveal-on`, which
              is the finer grain this block wanted anyway. */}
          <div className="pdp-grid" data-no-reveal>
            {/* LEFT COLUMN — STICKY SQUARE STAGE, THUMBNAIL RAIL BENEATH */}
            <div className="pdp-gallery-layout">
              <div className="pdp-stage-column">
                {/* Sliding stage: every photo sits in one track that
                    translates sideways. Swipe or drag to move, click to open
                    fullscreen — a drag never counts as that click. */}
                <div
                  className={`pdp-gallery${drag ? ' is-dragging' : ''}`}
                  data-enter={stageEnter ?? undefined}
                  onClick={() => {
                    if (dragMoved.current) {
                      dragMoved.current = false
                      return
                    }
                    setIsFullscreen(true)
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return
                    dragMoved.current = false
                    setDrag({ startX: e.clientX, dx: 0 })
                  }}
                  onPointerMove={(e) => {
                    if (!drag) return
                    const dx = e.clientX - drag.startX
                    if (Math.abs(dx) > 6) dragMoved.current = true
                    setDrag({ startX: drag.startX, dx })
                  }}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onPointerLeave={endDrag}
                >
                  <div
                    key={product.id}
                    className="pdp-gallery-track"
                    style={{ transform: `translateX(calc(${-imgIdx * 100}% + ${dragPx}px))` }}
                  >
                    {extra.gallery.map((g, i) => (
                      <div
                        key={i}
                        className={`pdp-gallery-slide${i === imgIdx ? ' is-current' : ''}`}
                        aria-hidden={i !== imgIdx}
                      >
                        {isPanty ? (
                          <PantyArt variant={g as 'lilac' | 'plum' | 'gold'} />
                        ) : (
                          // First photo is the LCP image: eager + high priority.
                          <img
                            src={g}
                            alt={i === imgIdx ? product.name : ''}
                            draggable={false}
                            decoding="async"
                            loading={i === 0 ? 'eager' : 'lazy'}
                            fetchPriority={i === 0 ? 'high' : undefined}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {galleryCount > 1 && (
                    <>
                      <button
                        type="button"
                        className="pdp-gallery-nav is-prev"
                        onClick={(e) => {
                          e.stopPropagation()
                          goImg(imgIdx - 1)
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={imgIdx === 0}
                        aria-label="Previous photo"
                      >
                        <Chevron dir="left" />
                      </button>
                      <button
                        type="button"
                        className="pdp-gallery-nav is-next"
                        onClick={(e) => {
                          e.stopPropagation()
                          goImg(imgIdx + 1)
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={imgIdx === galleryCount - 1}
                        aria-label="Next photo"
                      >
                        <Chevron dir="right" />
                      </button>
                      <div className="pdp-gallery-dots" aria-hidden="true">
                        {extra.gallery.map((_, i) => (
                          <i key={i} className={i === imgIdx ? 'is-active' : undefined} />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* No thumbnail rail: the stage itself is the gallery — swipe,
                    arrows and dots move between photos, and the photo gets the
                    column's full height. */}
              </div>
            </div>

            {/* RIGHT COLUMN — PRODUCT INFORMATION

                Ordered the way Lumi9's buy box is ordered: identity, then
                proof, then what it is, then what it costs, then the two
                choices that change that cost, then the button. The badges and
                the share row moved BELOW the button for the same reason —
                nothing that cannot be bought sits between the price and the
                thing that buys it. */}
            <div className="pdp-right-col">
              <span className="pdp-eyebrow" data-reveal-on>SANITARY &amp; PERIOD CARE</span>
              <h1 className="pdp-title" data-reveal-on="40">{product.name}</h1>

              {/* Rating Row with Score */}
              <div className="pdp-rating-row" data-reveal-on="80">
                <Stars rating={averageRating} />
                <span className="pdp-rating-score">{averageRating.toFixed(1)} / 5</span>
                <span className="pdp-rating-count">({reviewTotal} reviews)</span>
                <span className="pdp-rating-divider">&middot;</span>
                <span className="pdp-rating-sub">Organic Certified</span>
              </div>

              {/* Short Description — above the price, as on Lumi9: she reads
                  what it is before she reads what it costs. */}
              <p className="pdp-desc-text" data-reveal-on="120">{shortDescription}</p>

              {/* Price Line with Was Price, Active Price & Discount Badge */}
              <div className="pdp-price-block" data-reveal-on="160">
                <div className="pdp-price-line">
                  <span className="pdp-was-price">{rupees(Math.round(basePrice * 1.18))}</span>
                  <span className="pdp-now-price">{rupees(effPrice)}</span>
                  <span className="pdp-discount-badge">-15% OFF</span>
                </div>
                <span className="pdp-tax-note">Tax included. Free shipping on orders over Rs. 499.</span>
              </div>

              {/* SIZE — every length is its own product, so every chip is a real
                  route. The URL therefore always matches the choice, which is
                  the whole point: a size she picked is a size she can send to
                  someone. `scroll={false}` keeps the page where she was
                  reading; `prefetch` is left at Next's default so hovering the
                  row does not fetch four product pages she never asked for. */}
              {!isPanty && sizeOptions.length > 1 && (
                <div className="pdp-block">
                  <div className="pdp-slider-head">
                    <div className="pdp-label">
                      Size
                      <span className="pdp-label-note">
                        &middot; {sizeOptions[activeSizeIdx]?.label ?? mmPart}
                      </span>
                    </div>
                    <div className="pdp-slider-arrows">
                      <button
                        type="button"
                        className="pdp-slider-arrow"
                        onClick={() => stepSize(-1)}
                        disabled={activeSizeIdx === 0}
                        aria-label="Previous size"
                      >
                        <Chevron dir="left" />
                      </button>
                      <button
                        type="button"
                        className="pdp-slider-arrow"
                        onClick={() => stepSize(1)}
                        disabled={activeSizeIdx === sizeOptions.length - 1}
                        aria-label="Next size"
                      >
                        <Chevron dir="right" />
                      </button>
                    </div>
                  </div>
                  <SlideTrack active={activeSizeIdx} label="Choose a size">
                    {sizeOptions.map((option, i) => (
                      <Link
                        key={option.slug}
                        to={`/product/${option.slug}`}
                        scroll={false}
                        data-slide-item
                        className={`pdp-slider-opt${i === activeSizeIdx ? ' is-active' : ''}`}
                        aria-current={option.slug === product.id ? 'true' : undefined}
                        onClick={() => setPendingSize(option.slug)}
                      >
                        <b>{option.label}</b>
                        <span>{option.sub}</span>
                        {option.mm > 0 && (
                          <span className="pdp-len" aria-hidden="true">
                            <i style={{ width: `${(option.mm / maxMm) * 100}%` }} />
                          </span>
                        )}
                      </Link>
                    ))}
                  </SlideTrack>
                </div>
              )}

              {/* Panty Sizes — one product, four variants, so this one picks in
                  place and writes the choice to `?size=` instead of navigating. */}
              {isPanty && product.sizes && (
                <div className="pdp-block">
                  <div className="pdp-label">Choose your size</div>
                  <SlideTrack active={sizeIdx} label="Choose your size">
                    {product.sizes.map((sz, i) => (
                      <button
                        key={sz}
                        type="button"
                        data-slide-item
                        className={`pdp-slider-opt${i === sizeIdx ? ' is-active' : ''}`}
                        onClick={() => selectSize(i)}
                        aria-pressed={i === sizeIdx}
                      >
                        <b>{sz}</b>
                      </button>
                    ))}
                  </SlideTrack>
                </div>
              )}

              {/* Pack Selector */}
              {packs && (
                <div className="pdp-block">
                  <div className="pdp-slider-head">
                    <div className="pdp-label">Choose your pack</div>
                    {selectedPack && (
                      <span className="pdp-slider-note" key={packIdx}>
                        {perPad(selectedPack.price, selectedPack.count)} per pad
                      </span>
                    )}
                  </div>
                  <SlideTrack active={packIdx} label="Choose your pack" className="is-pack">
                    {packs.map((pk, i) => (
                      <button
                        key={pk.count}
                        type="button"
                        data-slide-item
                        className={`pdp-slider-opt${i === packIdx ? ' is-active' : ''}`}
                        onClick={() => setPackIdx(i)}
                        aria-pressed={i === packIdx}
                      >
                        {i === bestPackIdx && <em className="pdp-slider-tag">Best value</em>}
                        <b>{pk.count} pcs</b>
                        <span>{rupees(pk.price)}</span>
                      </button>
                    ))}
                  </SlideTrack>
                </div>
              )}

              {/* Purchase Options */}
              <div className="pdp-block">
                <div className="pdp-label">Purchase options</div>
                <div className="sub-options" role="radiogroup" aria-label="Purchase options">
                  <button
                    className={`sub-row${mode === 'once' ? ' active' : ''}`}
                    onClick={() => setMode('once')}
                    aria-pressed={mode === 'once'}
                  >
                    <span className="sub-radio-dot" />
                    <div className="sub-row-content">
                      <b>One-time purchase</b>
                      <span>{rupees(basePrice)}</span>
                    </div>
                  </button>
                  <button
                    className={`sub-row${mode === 'sub' ? ' active' : ''}`}
                    onClick={() => setMode('sub')}
                    aria-pressed={mode === 'sub'}
                  >
                    <span className="sub-radio-dot" />
                    <div className="sub-row-content">
                      <b>Subscribe &amp; save {subscribeSavePct}%</b>
                      <span>{rupees(subscriptionPrice)} &middot; skip or cancel anytime</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Quantity Stepper & Add to Bag */}
              <div className="cta-row">
                <div className="qty-stepper">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">&minus;</button>
                  <span>{qty}</span>
                  <button onClick={() => setQty((q) => q + 1)} aria-label="Increase">+</button>
                </div>
                <button
                  className={`add-to-bag-btn${ctaPulsing ? ' is-added' : ''}`}
                  onClick={submit}
                  disabled={subBusy}
                >
                  <Bag />{' '}
                  {subBusy
                    ? 'Setting up auto-pay…'
                    : `${mode === 'sub' ? 'Start subscription' : 'Add to bag'} - ${rupees(effPrice * qty)}`}
                </button>
              </div>

              {/* TRUST STRIP — the four badges, moved below the button and
                  gathered onto one tinted panel, the way Lumi9 groups them.
                  Above the button they were four circles of reassurance sitting
                  between the price and the purchase; below it they are what
                  they always were, a footnote. */}
              <div className="pdp-benefit-badges" data-reveal-on>
                <div className="pdp-benefit-item">
                  <div className="benefit-circle"><Leaf /></div>
                  <span>Organic Cotton</span>
                </div>
                <div className="pdp-benefit-item">
                  <div className="benefit-circle"><ShieldCheck /></div>
                  <span>Chlorine Free</span>
                </div>
                <div className="pdp-benefit-item">
                  <div className="benefit-circle"><Check /></div>
                  <span>Dermat Tested</span>
                </div>
                <div className="pdp-benefit-item">
                  <div className="benefit-circle"><Drop /></div>
                  <span>All Flow Types</span>
                </div>
              </div>

              {/* Social Share Row (Reference Layout) */}
              <div className="pdp-share-row">
                <span className="pdp-share-label">Share:</span>
                {/* Real share intents carrying THIS product's URL. These used
                    to point at the bare social homepages, so "share" opened
                    facebook.com with nothing attached. Instagram has no web
                    share intent at all, so it becomes a copy-link button.
                    WhatsApp is deliberately absent from the product page. */}
                <div className="pdp-share-links">
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pdp-share-link"
                    aria-label="Share on Facebook"
                  >
                    <Facebook />
                  </a>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${product.name} ${shareUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pdp-share-link"
                    aria-label="Share on WhatsApp"
                  >
                    <Whatsapp />
                  </a>
                  <button
                    type="button"
                    className="pdp-share-link"
                    onClick={copyShareLink}
                    aria-label="Copy link to this product"
                  >
                    <ICopy />
                  </button>
                </div>
              </div>

              {/* Collapsible Accordions */}
              <div className="pdp-accordions">
                <details className="pdp-accordion-item" open>
                  <summary className="pdp-accordion-summary">Product Information</summary>
                  <div className="pdp-accordion-body">
                    <p>{extra.long}</p>
                  </div>
                </details>
                <details className="pdp-accordion-item">
                  <summary className="pdp-accordion-summary">Specifications &amp; Materials</summary>
                  <div className="pdp-accordion-body">
                    <dl className="specs-table">
                      {extra.specs.map((s) => (
                        <div className="spec-item" key={s.k}>
                          <dt className="spec-key">{s.k}</dt>
                          {/* Decorative leader line. It used to be an empty
                              <dd>, which made VoiceOver announce a blank
                              definition before every real one. */}
                          <span className="spec-dash" aria-hidden="true" />
                          <dd className="spec-val">{s.v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </details>
                <details className="pdp-accordion-item">
                  <summary className="pdp-accordion-summary">Shipping &amp; Delivery</summary>
                  <div className="pdp-accordion-body">
                    <p>Free standard shipping across India on orders over Rs. 499. Orders dispatch within 24 hours in discreet, eco-friendly paper packaging.</p>
                  </div>
                </details>
              </div>
            </div>
          </div>

          {/* 2. KEY BENEFITS — six claims wrapped around the product itself.
              This replaced a single flat "benefits" banner: one 420KB image
              carrying baked-in text, which no screen reader could read, no
              translation could touch, and no admin could edit without opening
              Photoshop. The copy now lives in src/data/productBenefits.ts. */}
          <KeyBenefits
            productId={product.id}
            productName={product.name}
            features={extra.features}
            imageBase={benefitsBase}
            imageSrc={product.img}
          />

          {/* 3. REAL STORIES — customer video clips, above the written reviews
              because a face carries further than a paragraph. Renders nothing
              until clips are configured; see src/data/videoTestimonials.ts. */}
          <VideoTestimonials productId={product.id} />

          {/* 4. CUSTOMER REVIEWS — paged carousel, per-card helpful votes and the
              rating summary. The histogram that used to be computed here moved
              into the component along with everything else it labels. */}
          <ProductReviews
            reviews={reviews}
            averageRating={averageRating}
            reviewTotal={reviewTotal}
            onWriteReview={openReviewForm}
            onAskQuestion={askQuestion}
          />

          {/* 5. RECOMMENDED PRODUCTS (Frequently Bought Together — Reference Layout) */}
          <section className="pdp-related-section">
            <div className="pdp-sec-head">
              <h2 className="pdp-sec-title">Frequently Bought Together</h2>
              <p className="pdp-sec-subtitle">
                Complete your personal care routine with these organic essentials.
              </p>
            </div>

            <div className="related-grid">
              {related.slice(0, 4).map((p) => (
                <article className="related-card" key={p.id}>
                  {/* Link and hover CTA are SIBLINGS in this wrapper, never
                      nested: a <button> inside an <a> is invalid markup and the
                      browser would have to guess which one a click meant. */}
                  <div className="related-img-wrap">
                    <Link to={`/product/${p.id}`} className="related-img-box">
                      <span className="related-badge">{p.flow || 'Sanitary Care'}</span>
                      <img
                        src={p.img || '/assets/img/pad-detail-1.webp'}
                        alt={p.name}
                        width={720}
                        height={960}
                        loading="lazy"
                        decoding="async"
                      />
                    </Link>
                    {defaultVariantOf(p) && (
                      <RelatedQuickAdd name={p.name} onAdd={() => addRelated(p)} />
                    )}
                  </div>
                  <div className="related-card-content">
                    <Link to={`/product/${p.id}`} className="related-title">{p.name}</Link>
                    <p className="related-desc">{p.desc}</p>
                    {/* A struck-through `price * 1.18` and a literal "-15% OFF"
                        pill used to sit here. There is no compareAtPrice in the
                        catalog, so that MRP was synthesised — presenting a
                        fabricated reference price is consumer-law exposure in
                        India, not merely a UI bug. */}
                    <div className="related-price-block">
                      <b className="related-now-price">{rupees(p.price)}</b>
                    </div>

                    {/* The add control moved onto the photo as a hover reveal
                        (see `.related-quick-add` above). Only the sold-out case
                        still prints a button here, because "Sold out" is
                        information the card must state outright rather than
                        hide behind a hover the shopper has no reason to try. */}
                    {!defaultVariantOf(p) && (
                      <button type="button" className="related-add-btn-pill" disabled>
                        <Bag /> Sold out
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Persistent mobile add-to-bag bar. app.css has styled `.pdp-mobile-bar`
          — safe-area padding, z-index and all — since before this rewrite, but
          nothing ever rendered it: the only CTA was the `.cta-row` roughly
          1400px down a 360px page, with the benefits banner, the reviews and the
          related strip below it and no way back. `display:none` above 768px, so
          desktop never sees it. */}
      <div className="pdp-mobile-bar">
        <button className="btn btn-primary" onClick={submit} disabled={subBusy}>
          <Bag />{' '}
          {subBusy
            ? 'Setting up auto-pay…'
            : `${mode === 'sub' ? 'Start subscription' : 'Add to bag'} - ${rupees(effPrice * qty)}`}
        </button>
      </div>

      {/* Review / question modal. One dialog, two forms — they share the name
          field, the sending state and the whole shell, and splitting them would
          duplicate all of that to vary three inputs. */}
      {reviewOpen && (
        <div
          className="pdp-modal"
          role="dialog"
          aria-modal="true"
          aria-label={rvMode === 'review' ? 'Write a review' : 'Ask a question'}
        >
          <button className="pdp-modal-backdrop" onClick={() => setReviewOpen(false)} aria-label="Close form" />
          <div className="pdp-modal-card">
            <button className="pdp-modal-close" onClick={() => setReviewOpen(false)} aria-label="Close"><Close /></button>
            {rvState === 'sent' ? (
              <div className="review">
                {rvMode === 'review' ? (
                  <>
                    <b style={{ color: 'var(--ink)' }}>Thanks - your review is awaiting approval.</b>
                    <p style={{ marginTop: 8, color: 'var(--text-soft)' }}>
                      We read every review before it goes live. It will appear here once approved.
                    </p>
                  </>
                ) : (
                  <>
                    <b style={{ color: 'var(--ink)' }}>Thanks - your question is on its way.</b>
                    <p style={{ marginTop: 8, color: 'var(--text-soft)' }}>
                      Our care team will reply to you by email, usually within one working day.
                    </p>
                  </>
                )}
              </div>
            ) : rvMode === 'review' ? (
              <form className="review-form" onSubmit={submitReview}>
                <div>
                  <div className="pdp-label" style={{ marginBottom: 8 }}>Write a review</div>
                  <h2 className="pdp-title" style={{ fontSize: 24 }}>Share your experience</h2>
                </div>
                <span className="stars" role="radiogroup" aria-label="Your rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRvRating(n)}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      aria-pressed={rvRating === n}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0, color: 'inherit' }}
                    >
                      <IStar style={{ opacity: n <= rvRating ? 1 : 0.24 }} />
                    </button>
                  ))}
                </span>
                <input
                  value={rvName}
                  onChange={(e) => setRvName(e.target.value)}
                  placeholder="Your name"
                  aria-label="Your name"
                  autoComplete="name"
                  required
                  style={rvInput}
                />
                <input
                  value={rvPlace}
                  onChange={(e) => setRvPlace(e.target.value)}
                  placeholder="City (optional)"
                  aria-label="City (optional)"
                  autoComplete="address-level2"
                  style={rvInput}
                />
                {/* The headline the review card prints above the body. Optional:
                    a shopper who only wants to write two sentences should not be
                    stopped by a field asking her to title them. */}
                <input
                  value={rvTitle}
                  onChange={(e) => setRvTitle(e.target.value)}
                  placeholder="Give your review a title (optional)"
                  aria-label="Review title (optional)"
                  maxLength={120}
                  style={rvInput}
                />
                <textarea
                  value={rvBody}
                  onChange={(e) => setRvBody(e.target.value)}
                  placeholder="Share your experience"
                  aria-label="Share your experience"
                  required
                  rows={4}
                  style={{ ...rvInput, resize: 'vertical' }}
                />
                {rvState === 'error' && <p style={{ color: 'var(--mustard-deep)', fontSize: '.88rem', margin: 0 }}>Something went wrong. Please try again.</p>}
                <button type="submit" className="add-to-bag-btn" disabled={rvState === 'sending'}>
                  {rvState === 'sending' ? 'Submitting...' : 'Submit review'}
                </button>
              </form>
            ) : (
              <form className="review-form" onSubmit={submitQuestion}>
                <div>
                  <div className="pdp-label" style={{ marginBottom: 8 }}>Ask a question</div>
                  <h2 className="pdp-title" style={{ fontSize: 24 }}>About {product.name}</h2>
                </div>
                <input
                  value={rvName}
                  onChange={(e) => setRvName(e.target.value)}
                  placeholder="Your name"
                  aria-label="Your name"
                  autoComplete="name"
                  required
                  style={rvInput}
                />
                {/* Required here, unlike on a review: the answer comes back by
                    email, so without it the question has nowhere to go. */}
                <input
                  type="email"
                  value={qEmail}
                  onChange={(e) => setQEmail(e.target.value)}
                  placeholder="Your email"
                  aria-label="Your email"
                  autoComplete="email"
                  required
                  style={rvInput}
                />
                <textarea
                  value={rvBody}
                  onChange={(e) => setRvBody(e.target.value)}
                  placeholder="What would you like to know?"
                  aria-label="What would you like to know?"
                  required
                  rows={4}
                  style={{ ...rvInput, resize: 'vertical' }}
                />
                {rvState === 'error' && <p style={{ color: 'var(--mustard-deep)', fontSize: '.88rem', margin: 0 }}>Something went wrong. Please try again.</p>}
                <button type="submit" className="add-to-bag-btn" disabled={rvState === 'sending'}>
                  {rvState === 'sending' ? 'Sending...' : 'Send question'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Image Modal */}
      {isFullscreen && (
        <div className="pdp-modal pdp-image-modal" role="dialog" aria-modal="true" aria-label="Product image fullscreen">
          <button className="pdp-modal-backdrop" onClick={() => setIsFullscreen(false)} aria-label="Close image view" />
          <div className="pdp-image-modal-card">
            <button className="pdp-modal-close" onClick={() => setIsFullscreen(false)} aria-label="Close"><Close /></button>
            {renderGalleryImage(true)}
          </div>
        </div>
      )}
    </div>
  )
}

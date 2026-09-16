import type { Metadata, Viewport } from 'next'
import Script from 'next/script'

// Lenis base styles (height:auto, overscroll containment) — required for the
// smooth scroll to behave. Then app CSS in cascade order: base tokens first,
// component styles next, responsive media queries LAST so they always win,
// immersive overrides last of all.
//
// The member-area sheets load after figma-landing-responsive.css on purpose:
// that file ships two UNSCOPED `!important` blocks that hit every .btn on the
// site, and member.css carries the sanctioned `!important` counter-override.
// Equal specificity + equal importance means source order decides, so these
// four must come last.
import 'lenis/dist/lenis.css'
import '@/styles/base.css'
import '@/components/Nav.css'
import '@/components/Hero.css'
import '@/components/HeroBanner.css'
import '@/components/TrustStrip.css'
import '@/components/Products.css'
import '@/components/WhyBento.css'
import '@/components/Story.css'
import '@/components/Impact.css'
import '@/components/Cta.css'
import '@/components/Footer.css'
import '@/components/CartDrawer.css'
import '@/charts/charts.css'
import '@/styles/app.css'
import '@/styles/blog.css'
import '@/styles/responsive.css'
import '@/immersive/immersive.css'
import '@/styles/figma-landing.css'
import '@/styles/figma-landing-responsive.css'
import '@/styles/member.css'
import '@/styles/auth.css'
import '@/styles/account.css'
import '@/styles/dashboard.css'
// ── De-slab craft layer — imported LAST so its polish overrides win over the
//    base stylesheets above. craft.css holds the shared tokens/utilities; each
//    craft-<area>.css targets one area's existing selectors. ──
import '@/styles/craft.css'
import '@/styles/craft-nav.css'
import '@/styles/craft-footer.css'
import '@/styles/craft-home.css'
import '@/styles/craft-type.css'
import '@/styles/craft-home-type.css'
import '@/styles/craft-buttons.css'
import '@/styles/craft-cart.css'
// /shop's filter + sort rail. After the craft layer: its `.shop-layout
// .grid-products` override has to outrank the column counts in Products.css.
import '@/components/ShopCatalog.css'
// /dashboard's own comp sheet. Last of all: it repaints `.m-card` and the
// heading roles INSIDE `.f9dash`, and those rules must outrank both member.css
// and the craft layer above at equal specificity.
import '@/styles/f9dash.css'
// The Lumi9 scroll. Attribute-driven and JS-armed, so it can only ever add an
// entrance — it never hides server-rendered markup. See ScrollMotion.tsx.
import '@/styles/motion.css'
// Final mobile-only repair layer. Keep this last: craft-nav.css currently uses
// !important on several header rules, so the phone-specific fixes must win the
// cascade without touching the desktop presentation.
import '@/styles/mobile-polish.css'

import { Providers } from './providers'
import { optSrc, optSrcSet } from '@/components/OptImg'

/**
 * The two images worth preloading, and the `sizes` each renders at.
 *
 * HERO_LCP_SIZES must stay byte-identical to the `sizes` on the `.fl-hero__lifestyle`
 * <OptImg> in src/screens/Home.tsx; NAV_LOGO_SIZES to the one in src/components/Nav.tsx.
 */
const HERO_LCP = 'figma-home/hero-lifestyle' as const
const HERO_LCP_SIZES = '(max-width: 768px) 82vw, (max-width: 1080px) 43vw, min(46vw, 680px)'
const NAV_LOGO = 'figma-home/navbar-imgImage29' as const
const NAV_LOGO_SIZES = '116px'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'Femi9 - Organic, breathable period care',
  description:
    'Femi9 makes ultra-thin, breathable organic cotton sanitary pads with a mood-lifting anion strip. Toxin-free, biodegradable, and made for real life.',
  icons: { icon: '/assets/img/logo.png' },
  alternates: {
    canonical: 'https://femi9.in/',
  },
}

/**
 * Next only injects `width=device-width, initial-scale=1` by default, which
 * leaves `viewport-fit` unset — and with it unset `env(safe-area-inset-*)`
 * resolves to 0 in every browser. Several sheets already budget for the notch
 * and the home indicator (the cart drawer foot, the PDP buy bar, the nav below),
 * so those declarations were silently doing nothing. `cover` arms them.
 *
 * Deliberately NO `maximum-scale` / `user-scalable=no`: pinch-zoom must stay
 * available. Every fixed or sticky bar that touches an edge has to carry its own
 * `env(safe-area-inset-*)` padding now, or it paints under the notch.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#352D78',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions stamp attributes onto <html>
    // before React hydrates (QuillBot adds `data-qb-installed` and a lowercase
    // `suppresshydrationwarning`), which React reported as a server/client
    // mismatch. Like the matching prop on <body> below, it only silences
    // attribute differences on this one element — mismatches in the page
    // content are still reported.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* LCP hero photo + nav logo are React-rendered, so the browser can't
            discover them until the bundle runs. Preloading puts them in flight
            with the HTML.

            The srcset is derived from the same generated manifest <OptImg> uses,
            so a rebuild that changes the derivative ladder cannot leave this out
            of step. `imageSizes` still has to be copied by hand — keep it byte-
            identical to the `sizes` on the matching element, or the browser
            resolves the preload to one derivative and the element to another and
            the phone downloads both. */}
        <link
          rel="preload"
          as="image"
          href={optSrc(HERO_LCP)}
          imageSrcSet={optSrcSet(HERO_LCP)}
          imageSizes={HERO_LCP_SIZES}
          fetchPriority="high"
        />
        <link
          rel="preload"
          as="image"
          href={optSrc(NAV_LOGO)}
          imageSrcSet={optSrcSet(NAV_LOGO)}
          imageSizes={NAV_LOGO_SIZES}
          fetchPriority="high"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Instrument+Sans:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Urbanist:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,600&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,300;1,6..72,400&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Dancing+Script:wght@600&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Femi9',
              url: 'https://femi9.in',
              description: 'Comfortable, breathable sanitary pads and period care products',
              contactPoint: {
                '@type': 'ContactPoint',
                telephone: '+91-90429-16499',
                email: 'support@femi9.in',
              },
            }),
          }}
        />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla adds
          `cz-shortcut-listen`, Grammarly adds `data-gr-*`) inject attributes onto
          <body> before React hydrates. That is the one element they reliably
          touch, so we tolerate attribute diffs here — this does NOT hide real
          hydration mismatches elsewhere in the tree. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
        {/* <pad-exploder> web component (zero-dep custom element). Loaded here
            rather than bundled so it stays framework-agnostic. */}
        <Script src="/pad-exploder.js" strategy="afterInteractive" />
        {/* Press Ripple for cart buttons (Femi9 "Five Animations"): a ripple
            blooms from the click point. Delegated + zero-dep; honours reduced motion. */}
        <Script id="f9-btn-ripple" strategy="afterInteractive">{`
          document.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('.add-to-bag-btn, .related-add-btn-pill, [data-ripple]');
            if (!btn) return;
            if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            var r = btn.getBoundingClientRect();
            var size = Math.max(r.width, r.height) * 2.2;
            var s = document.createElement('span');
            s.style.cssText = 'position:absolute;border-radius:999px;background:rgba(255,255,255,.5);pointer-events:none;transform:scale(0);opacity:1;width:' + size + 'px;height:' + size + 'px;left:' + (e.clientX - r.left - size / 2) + 'px;top:' + (e.clientY - r.top - size / 2) + 'px;animation:f9ripple .6s ease-out forwards';
            var cs = getComputedStyle(btn);
            if (cs.position === 'static') btn.style.position = 'relative';
            btn.style.overflow = 'hidden';
            btn.appendChild(s);
            setTimeout(function () { s.remove(); }, 640);
          }, true);
        `}</Script>
      </body>
    </html>
  )
}
# CLAUDE.md — Femi9 web (`apps/femi9-web`)

Instructions for Claude Code working in this app. Read this before every task.
Platform-level context lives in the repo-root `CLAUDE.md`.

## 0. Scope rule (non-negotiable)

**Work only inside `apps/femi9-web/`.** Two neighbours you must not wander into:

- `apps/lumi9-web/` — the other brand. Touch it only when a task explicitly
  names the two-brand integration.
- The **repo root** holds dead prototypes — `femi9-app/`, `femi9-react/`,
  `femi9-scrool/`, `femi9-lavender/`, and the loose `index.html` / `app.js` /
  `styles.css`. Never read them for patterns and never edit them.

The PDFs at the repo root (`Femi9-Backend-PRD.pdf`,
`Femi9-Flows-and-Architecture.pdf`, `Femi9-Thara-Model-Explained.pdf`) are the
only root files worth consulting, and only when a task needs product intent.

## 1. What this is

Femi9 — Indian D2C period-care brand (pads + period panties). Next.js App
Router: storefront, customer account, and the ops console in one deploy, backed
by Postgres. One of two apps in the `femi9-platform` workspace, pinned to the
same exact Next version as `lumi9-web`.

| | |
| --- | --- |
| Framework | Next.js 16.3.1 (App Router, **Turbopack**) · React 19.2 · TypeScript strict |
| Data | PostgreSQL via Prisma 6 (`prisma/schema.prisma`, ~60 models) |
| Styling | Hand-written CSS in `src/styles/*.css` + colocated `*.css`. **No Tailwind.** |
| Auth | Stateless HS256 JWTs in httpOnly cookies (`jose`) |
| Payments | Razorpay — one-off orders, **recurring mandates** (Subscriptions API), webhook, reconcile cron |
| Messaging | Resend (email) · WhatsApp Cloud API (**sign-in OTP + order status**) · MSG91 (reward codes only) |
| Tests | Vitest (`npm test`) · Playwright (`npm run test:ui`) |
| Errors | Sentry (client/server/edge configs at app root) |

## 2. Layout

```
app/
  (store)/            storefront: home, shop, product/[id], checkout, blog, thara, …
  account/ dashboard/ welcome/    signed-in customer surface
  api/                route handlers (customer + webhooks + cron)
  a/[code] r/[code]   affiliate + Thara referral short links

There is NO admin here any more — see below.
src/
  lib/                CLIENT-side only now — 9 files: router-compat, track,
                      use-add-pulse, use-public-settings, sticky-nav,
                      opt-images, safe-next, session, thara/terms.
                      Everything server-side moved to @femi9/core.
  components/ screens/ store/ styles/ charts/ immersive/ data/
prisma/               seed.ts · seed-zones.ts · seed-demo.ts  (brand-specific
                      seed DATA only — schema + migrations are in packages/db)
middleware.ts         edge guard for /admin, /api/admin, /account, /dashboard, /welcome
docs/                 GEOIP.md · TWO-BRAND-ARCHITECTURE.md · phases/ · thara/
```

## 3. Rules that matter here

**The Prisma schema is NOT in this app.** It lives in `packages/db`
(`@femi9/db`), shared with the other brand. `src/lib/db.ts` is now a thin,
deliberately LAZY re-export that pins `dbFor('femi9')` behind the import path
~80 call sites already use. It is lazy because `dbFor()` needs `DATABASE_URL` at
construction and the Docker build stage has no credentials — constructing
eagerly would break `next build` in the image. New service code should call
`dbFor(brand)` directly rather than importing this shim.

The `db:*` scripts pass `--schema ../../packages/db/prisma/schema.prisma`; they
still run from THIS directory because that is where `.env` is, and the Prisma
CLI reads env from its working directory.

**Business logic lives in `@femi9/core`, not in this app.** Route handlers parse
+ authorize + delegate. Pages and server components import services directly —
they do not fetch their own API. If you are writing a Prisma query inside `app/`,
stop and put it in a service in `packages/core`.

Import by subpath — there is no barrel, on purpose (one would drag Razorpay,
Prisma and the mail client into any consumer wanting a single helper):

```ts
import { ok, badRequest, handle } from '@femi9/core/api'
import { requireAdmin }           from '@femi9/core/admin-auth'
import { getOrders }              from '@femi9/core/services/admin/orders'
```

**Every service in `@femi9/core` takes `brand` as its first parameter** and
resolves its own client with `dbFor(brand)`. Core exports no client of its own,
so there is nothing there for a second brand to import by accident.

`src/lib/db.ts` is a Femi9-pinned lazy client for the ~18 route handlers and
pages in THIS app that still query Prisma directly. Pinning a brand is fine for
a single-brand app; it was only dangerous while it lived in the shared package.
Those direct queries are debt — the architecture says they belong in a service.
Each one moved into `packages/core` is one fewer file importing this.

**The ops console is not in this app.** It lives in `apps/admin`, serves both
brands, and has its own per-brand cookies. `/admin` here redirects there when
`ADMIN_CONSOLE_URL` is set, and 404s otherwise. Do not add admin pages or
`/api/admin/*` routes back — the storefront's own E2E asserts that surface is
gone.

**⚠️ The cron routes' admin fallback is now inert.** `/api/cron/*` accept either
a matching `x-cron-secret` OR a signed-in admin. This app no longer mints an
admin cookie, so that second path can never succeed — **`CRON_SECRET` must be
set**, or subscription skip-resumes, legacy renewals and Thara cycle closing have
no way in. The routes were left otherwise untouched on purpose: they move money.

**Subscriptions are billed by a Razorpay MANDATE — the gateway owns the
calendar.** Three things follow, and all three are easy to get wrong:

1. **A new plan is INERT.** `POST /api/subscriptions` writes `pending_mandate`
   and creates the gateway subscription; nothing is EVER debited until the
   customer's bank approves it through `src/lib/mandate.ts` and
   `POST /api/subscriptions/[id]/authorize`. A 201 means "ready to authorise".
   To finish an abandoned one, re-`GET` that route — never POST
   `/api/subscriptions` again, or she gets two plans and two debits a cycle.
2. **A recurring order is created by the `subscription.charged` webhook**, in
   `recordSubscriptionCharge`, after the money has arrived — so it is born
   `paid`, with a real Payment row, and it is NEVER refused. A stock shortfall
   logs a backorder and still creates the order; refusing would mean the bank
   had moved the money and we had recorded nothing.
3. **`generateDueOrders` (the renew cron) serves LEGACY plans only** —
   `razorpaySubscriptionId IS NULL`. Drop that filter and every mandated
   subscriber gets two boxes a cycle, one of them unpaid and holding stock.

"Skip next" is a pause plus a scheduled resume, because Razorpay has no
skip-one-cycle primitive; `/api/cron/resume-subscriptions` performs it. And
`RAZORPAY_WEBHOOK_SECRET` stops being optional here: a mandate debits with no
browser involved, so an unverifiable webhook means charges taken and no orders
created at all.

**Two cookies, two audiences, never crossed.**
`femi9_session` (aud `femi9-customer`, 30d) is this app's only session now.
`middleware.ts` re-implements verification inline with Web Crypto because it runs
on the edge; `@femi9/core/auth` is the Node-side counterpart. **Change one and
you must change the other** — the same check written twice, which is the cost of
the edge runtime. (The admin console avoids this: it uses `proxy.ts` on Node and
calls the shared verifier once.)

**This app uses `middleware.ts`, not `proxy.ts`, on purpose.** Next 16 renamed
the convention and every build warns about it. We have NOT migrated because
`proxy` runs on the Node runtime only and cannot be configured, while this file
is deliberately written to be edge-compatible. Migrating is a real decision, not
a rename — see the note in `docs/TWO-BRAND-ARCHITECTURE.md`. Do not "fix" the
warning by running the codemod without that decision being made.

**There is no ESLint here.** This app has never had a config, `next lint` was
removed in Next 16, and `next build` no longer lints. The `lint` script is gone
rather than left pretending to work. Adding real linting is worthwhile, but it
is its own task.

**Guard twice.** Middleware is the first gate, not the only one. Every
`/api/admin/*` handler still calls `requireAdmin()`; every customer handler still
calls `requireUser()`. Never rely on the matcher alone.

**Validate with Zod at the boundary.** Every handler parses its body with a
schema and returns `badRequest(msg, err.flatten())` via the helpers in
`@femi9/core/api` (`ok` / `badRequest` / `unauthorized` / `handle`). Use them —
don't hand-roll `NextResponse.json`.

**Rate-limit anything credential- or cost-bearing.** `rateLimit(key, n, windowMs)`
from `@femi9/core/rate-limit`, per-IP plus a global cap. See
`app/api/admin/login/route.ts` for the shape.

**Money is integer rupees.** No floats, no paise. Order totals snapshot
`productName` / `variantLabel` / `unitPrice` at purchase — never re-derive a past
order's price from the current catalog.

**Prices are resolved server-side, per zone.** `PriceZone` + `ZoneProductPrice` /
`ZoneVariantPrice` override `basePrice`; an exact zone price beats the zone's
`discountPct`. Never price a cart on the client.

**Cycle data is encrypted at rest.** `PeriodLog` / `SymptomLog` payloads go
through `@femi9/core/cycle-crypto` with `CYCLE_DATA_ENCRYPTION_KEY`. Never log,
export, or return them raw, and never widen who can read them.

**Thara is feature-flagged.** Every Thara route 404s unless the flag env is
exactly `"true"`. Keep new Thara work behind it.

**Soft deletes are real.** `Address.archivedAt` — every account read filters
`archivedAt IS NULL`, because orders reference addresses forever.

**CSS, not Tailwind.** Match the file you're editing. Shared tokens are in
`src/styles/base.css` / `app.css`; the `craft-*.css` family is the current design
system; `admin.css` and `f9dash.css` own the console.

**⚠️ `npm test` truncates every table.** `test/setup.ts` refuses to run unless
`DATABASE_URL` names a `*_test` database, and shell env beats `.env`, so point
`TEST_DATABASE_URL` at a scratch database and it cannot touch anything else:

```bash
createdb femi9_test                 # once
TEST_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/femi9_test?schema=public" npx vitest run
```

Push the schema in first with `npm run db:push`, pointing the same URL at
`DATABASE_URL`/`DIRECT_URL`. Full suite: 37 files, 247 tests, ~75s.

**Mock specifiers are strings, and TypeScript does not check them.** When a
module moves, `vi.mock('@/lib/x')` keeps compiling and silently stops mocking
anything — the test then exercises the real collaborator and can still "pass"
for the wrong reason. Grep `vi.mock(` after any move.

## 4. Commands

Run from the repo root (preferred) or inside this directory:

```bash
npm run dev:femi9              # from root — this app on :3000
npm run build:femi9            # from root
npm install                    # ALWAYS at the root; one hoisted lockfile

# from inside apps/femi9-web:
npm run build
npm run typecheck              # tsc --noEmit  (there is no `lint` script — see above)
npm test                       # vitest — SEE THE WARNING ABOVE
npm run test:ui                # playwright
npm run db:generate            # prisma generate
npm run db:migrate             # prisma migrate dev
npm run db:seed
npm run db:studio
```

There is **no app-level `package-lock.json`** — npm workspaces keep a single
hoisted lockfile at the repo root. `npm ci` only works there.

Env lives in `.env` (gitignored); `.env.example` is the contract — **add every
new var there** with a comment.

**Docker builds from the repo root, not here:**
```bash
docker build -f apps/femi9-web/Dockerfile -t femi9-web .
```

**This image had not built since phase 1b.** It copied
`src/lib/cycle-crypto.ts`, which moved to `packages/core` in that phase — the
211 files importing it were repointed, the Dockerfile was not, and a Dockerfile
is not something typecheck or the suite reads. `deploy-staging.yml` was failing
at the image step the whole time.

**The runtime layout changed: the image now runs from `/app/apps/femi9-web`.**
It used to flatten the standalone bundle to `/app/server.js`, which was right
before Next 16. Turbopack writes externalised server packages into
`.next/node_modules` as relative symlinks counted from the nested depth, so
flattening dangles all of them and the container dies loading its
instrumentation hook. Anything with a relative path — a `docker run` command, an
ECS `--overrides` — is relative to the app directory now.

## 5. Task log

Append one entry per task. Newest last.

| Date | Task | Touched | Notes |
| --- | --- | --- | --- |
| 2026-08-22 | Two-brand (Femi9 + Lumi9) platform architecture — brainstorm + plan | `CLAUDE.md` (new) · `docs/TWO-BRAND-ARCHITECTURE.md` (new) | Plan only, no code. Agreed: separate domains, **fully separate customer bases**, admin-only brand selection, two Razorpay accounts. |
| 2026-08-22 | Architecture revision after review | `docs/TWO-BRAND-ARCHITECTURE.md` | Admin brand pick is a **segmented toggle on the login form**, not a typed `femi9/` prefix (brand is untrusted client input — `AdminBrandRole` still decides). "Same backend" settled as **shared `packages/core`, not an extracted API service**. DB settled as **one Postgres, three schemas** (`femi9` · `lumi9` · `platform`). |
| 2026-08-23 | **Phase 0 — monorepo** | repo-wide | `femi9-next` → `apps/femi9-web`, `lumi9-web-main` → `apps/lumi9-web`. npm workspaces + Turborepo, one hoisted lockfile. Both apps build. Docker context moved to repo root; runtime layout kept flat and identical. CI/deploy paths updated, Lumi9 CI job added. Next upgrade deferred to Phase 0b. |
| 2026-08-23 | **Phase 0b — Next 16** | `package.json` · root `package.json` | Next 15.5.23 → **16.3.1** (exact, matching lumi9 — `next` now hoists to one copy). Builds on **Turbopack**; Sentry 10.70 is Turbopack-compatible, so no webpack conflict. `next lint` removed upstream → dead `lint` script dropped. Added `packageManager` to the root manifest (turbo could not resolve the workspace without it). **`middleware.ts` kept, not migrated to `proxy`** — open decision, see architecture doc. Zero `next/image` usage, so every image breaking change was moot. |
| 2026-08-23 | **Phase 1a — `packages/db`** | `packages/db/*` (new) · `src/lib/db.ts` · `Dockerfile` · `ci.yml` · `next.config.mjs` | Schema + 13 migrations → `@femi9/db`; seeds stayed (brand-specific). `dbFor(brand)` builds one client per brand from one schema — isolation in the connection string. `src/lib/db.ts` became a lazy Proxy shim so all ~80 call sites kept working and the credential-free Docker build still passes. Verified: proxy forwards delegates, `dbFor` memoises, `isBrand` rejects case/traversal/undefined, and **lumi9 refuses to fall back to femi9's `DATABASE_URL`**. |
| 2026-08-23 | **Phase 1b — `packages/core`** | 64 modules → `packages/core` · 211 files repointed | Server half of `src/lib` moved to `@femi9/core`; 9 client-side files stayed. Signatures UNCHANGED (move first, thread `brand` second) — services still use the pinned `core/db`. Catalog view-model types moved to `core/types/catalog`, re-exported from `src/data/*` so component imports were untouched. Subpath exports, no barrel. Verified: both packages typecheck, femi9 builds, no `@/` alias left in core, no unresolved `@femi9/*` require in the standalone bundle. |
| 2026-08-23 | **Phase 1c — `brand` threaded** | 35 core services · ~120 app/test files | All **161** core service functions now take `brand: Brand` first and call `dbFor(brand)`. Core exports **no** client; the Femi9 pin moved back to `apps/femi9-web/src/lib/db.ts` where pinning is legitimate. Every call site passes `'femi9'`, so behaviour is unchanged. Codemod gotchas worth remembering: a generic return type (`Promise<{...}>`) supplies a brace before the body; multi-line destructured params do too; `function f<T>(` isn't matched by `function f(`; arrow consts wrapped in `cache()` need it by hand; defaults like `db: Db = prisma` live in the signature, not the body. |
| 2026-08-23 | **Phase 4a — Lumi9 catalogue live** | `apps/lumi9-web/*` · `core/services/products.ts` | Lumi9's storefront reads the database. `getCatalog(brand)` added to core (brand-agnostic rows, with specs and real variant ids); Lumi9 maps them to its own size/pack shape and hands them to 12 client components through a provider. Whole tree `force-dynamic` — prerendering made the BUILD need a database the Docker stage does not have. Live data turned two stale-closure lint warnings into real bugs. |
| 2026-08-23 | **Phase 3 — Lumi9 data** | `packages/db` migrations · `apps/lumi9-web/prisma/*` · `brands.ts` | Lumi9 catalogue seeded (5 sizes, 12 variants, zones) and provable in isolation from Femi9. Found and fixed **migration drift**: cycle-encryption columns were `db push`-ed and never captured, so history could not rebuild the schema — `migrate diff` now clean. `ProductType += diaper`, and Femi9's vocabulary un-baked from the Zod boundary, the product form and `InventoryRow`. Product types are now per-brand and enforced at the routes. |
| 2026-08-23 | **Phase 2 — console moved out** | 15 pages + 31 routes → `apps/admin` | Every ops page and API left this app. Brand now comes from the SESSION (`requireConsole` / `requireConsoleApi`), never the URL segment. `/admin` redirects to `ADMIN_CONSOLE_URL` or 404s; `middleware.ts` no longer guards an admin surface. Storefront E2E rewritten: the seed script calls the services directly instead of the departed admin API, and both suites now assert the surface is **gone**. ⚠️ cron routes' admin fallback is inert — `CRON_SECRET` is required. |
| 2026-08-23 | **Phase 1 verified end-to-end** | `test/unit/geo-ladder.test.ts` | Ran the full suite against a LOCAL scratch `femi9_test`: **37 files / 247 tests pass**. Found a Phase 1b regression typecheck could not see — `vi.mock('@/lib/geo/mmdb'…)` still named the pre-move path, so the mocks were inert and 6 geo tests were exercising real lookups. Specifiers repointed at `@femi9/core/geo/*`. |
| 2026-08-25 | **PDP buy block on Lumi9's layout + site-wide scroll motion** | `screens/ProductDetail.tsx` · `product/[id]/page.tsx` · `lib/size-run.ts` · `lib/motion.ts` · `components/ScrollMotion.tsx` · `components/motion/Reveal.tsx` · `styles/pdp-buybox.css` · `styles/motion.css` · `app.css` · `craft-product.css` · `layout.tsx` · `providers.tsx` | Gallery is a **square sticky stage + horizontal thumb rail**; `.pdp-hero-gap-banner` deleted — it was an unrelated stock shot rendered only to fill the gap a 4:5 stage left beside a taller buy column, and it read as a second product photo. Buy column reordered to Lumi9's (desc above price, trust badges below the CTA), Femi9 tokens throughout. **Size picker changes the URL**: each pad length is its own product, so every chip is a `<Link>` to a sibling, derived from the catalogue at runtime (`sizeRun`) — never hardcoded, or it stops matching the day someone adds a 240mm. Period underwear is the one product with real size variants, so it writes `?size=`, resolved SERVER-side (a `useSearchParams` read would paint the default first and correct it after hydration). Lumi9's reveal + parallax ported and applied site-wide under the existing Lenis. Two invariants worth keeping: CSS hides only what JS tagged (`[data-reveal]`), so a failed bundle leaves the page visible, not blank; and the first pass after a full page load leaves on-screen blocks alone, because the server already painted them and fading them back in is a flash, not an entrance. Home/About skipped — `main.figma-landing` runs its own `data-visible` entrance. |
| 2026-09-14 | **PDP Apple-style configurator (frontend only)** | `screens/ProductDetail.tsx` · `styles/pdp-configurator.css` (new) · `styles/product-detail-extras.css` | Gallery column widened (1.4fr) and rebuilt as a **sliding track** — swipe/drag, arrows, dots, thumbnails still drive `imgIdx`; a drag never opens fullscreen. Size, panty size and pack pickers are one `SlideTrack` segmented control whose white pill is positioned from the active option's **measured** box (options are content-sized and the track scrolls). Size pill moves on tap via `pendingSize`, before the sibling route loads. After a client-side size switch the new pack slides in from the side it came from (module-scope `lastViewed`; null on full load, so no hydration mismatch or load flash). Pack shows per-pad price + "Best value" tag (display only). New class names on purpose, so the legacy `!important` `.pack-card` / `.pdp-hero-stage` rules cannot reach them; the extras sheet's full-width card rules and the overlapping `::before` "Product" pill were deleted. No API, data or pricing logic touched. |
| 2026-09-14 | **PDP reviews → pinned paper stack (frontend only)** | `components/ProductReviews.tsx` · `styles/pdp-reviews.css` | Three-card carousel replaced by a stack of cream notes under one pin, beside the rating summary (score · histogram · Write a Review / Ask a Question). Clicking the top note — or the next arrow — sends it to the back (`is-back` keyframe: lift off the pin, tuck behind) and reveals the next; previous brings it forward (`is-front`); the stack cycles. Notes share one grid cell, so the stack is as tall as its tallest review with no measuring; each depth rests on a `--rest` transform and the keyframes end on it. Non-top notes are `inert` + `aria-hidden`, so hidden vote buttons are not reachable; flips are announced via the existing live region. Data flow unchanged: `reviews` prop, votes still POST `/api/reviews/[id]/vote` (500s in this standalone copy — stubbed, pre-existing), actions still call ProductDetail's modal. `showAll`/paging removed with the carousel. |
| 2026-09-14 | **PDP Key Benefits → connector-line figure (frontend only)** | `components/KeyBenefits.tsx` · `styles/pdp-key-benefits.css` | Photo at the centre, three claims per side, each tied to the pack by a thin curved SVG line from a dot beside the title to a ring just inside the pack's edge (anchors are fractions of the 720×960 shot, shared by every product image). Still a three-column grid — only the lines are positioned, re-measured by ResizeObserver and drawn once on IntersectionObserver. Effect is keyed on `productId`, not `pack` (the DB fallback is rebuilt every render and would loop). Lines off below 900px (photo first, claims in 2 cols, 1 col ≤560). Icon badges dropped, so `BenefitIcons.tsx` is now unused but kept. Copy and images unchanged: packs still from `data/productBenefits.ts`, photo still `imageBase`/`product.img`. Gotcha: base.css's mobile `h1-h4 { margin-bottom: 8px }` is `!important` — overridden on `.kb-item-title` or the dot sits 4px low. Playwright element screenshots dropped the SVG layer; viewport screenshots show it. |
| 2026-09-14 | **PDP Key Benefits → floating pack (frontend only, supersedes the entry above)** | `components/KeyBenefits.tsx` · `styles/pdp-key-benefits.css` | Pack suspended at the centre, tilted −12° (−8° ≤900px), gently floating over a breathing floor shadow, with thin curved threads out to the six claims. **No transparent pack cut-out exists in the project** (every `assets/img` shot is opaque; the figma-home cut-outs are the pedestal render, hands, or model), so — user's choice — it floats the studio shot `img/sample` (9-pad Large on white) on EVERY product page: CSS crop to the pack + white margin (`CROP` in the component ↔ the `.kb-float img` percentages — change together), edge mask on the margin only, `mix-blend-mode: multiply` over a pure-white glow so the white drops out and pack colours stay true. **Blend gotcha:** tilt + float animation sit ON `.kb-float` itself; any transform/filter/z-index/will-change on an ancestor up to `.kb-section` isolates the blend and brings the white box back. Threads end just outside the rotated pack (`THREAD_ENDS`, pack-local coords rotated by `TILT_DEG`, which mirrors `--kb-tilt`). Entrance hides items only after JS arms the section. Per-product `imageBase`/`imageSrc` props kept but no longer rendered here. Copy unchanged (`resolveBenefits`). |
| 2026-09-14 | **Key Benefits threads now touch the pack** | `components/KeyBenefits.tsx` · `styles/pdp-key-benefits.css` | Threads end ON the pack edge (`TOUCH_POINTS`, pack-local u/v just inside the outline) with a small plum point. Because the pack floats, the float moved from a CSS keyframe to a rAF loop in the component: each frame sets `.kb-float`'s translate+tilt and recomputes the six path ends with the same lift/tilt, so threads never detach. Loop runs only while on screen and never under prefers-reduced-motion; no JS = pack rests at its CSS tilt. `measure` caches geometry so frames do no layout reads. Verified: end-to-edge distances identical across a float cycle. |
| 2026-09-14 | **/shop editorial catalog (CSS only)** | `components/ShopCatalog.css` (appended block) | Sharp hairline tiles on a warm `#f5f2ec` ground (`body:has(.shop-layout)`), inset photo, understated uppercase flow/badges, square pills. Everything scoped under `.shop-layout`, so the home rail's ProductCard is untouched; `!important` only on `.add`, where craft-buttons.css already uses it. Middle column staggered with `translate` (not `transform`, which the tile hover resets) + grid padding-bottom. Pointer devices: the existing hover "Add to cart" becomes a permanent bottom strip (card `position:relative`, `.card-media-wrap` static, card padding-bottom via `:has`). Touch keeps "Buy Now", restyled thin-bordered. Desktop rail flattening is `min-width:981px` only — below that the rail is a sheet and needs its panel background. No markup, data or logic changed; content verified identical before/after, cart POST, filter and sort still work. No wishlist control exists, so none was added. |
| 2026-09-14 | **Home "Why Femi9" → pinned scroll story (frontend only)** | `screens/Home.tsx` (markup wrap only) · `components/PadLayersStage.tsx` · `components/PadLayersStage.css` | **There is no product MP4** — the pad animation is the existing 90-frame cutout sequence (`assets/pad-frames-cutout`, frame 1 = exploded, 90 = assembled) drawn to canvas; that is the "video". Grid wrapped in `.fl-why__story[data-why-story]` (tall track, `100svh + 190vh`) > `.fl-why__pin` (sticky, 100svh). PadLayersStage finds the track via `closest('[data-why-story]')`, derives p = scrolled/(height − vh), publishes `--why-p`, and scrubs `storyExplodeAt(p)` (hold assembled → cubic explode by ~0.58 → hold exploded); no track = old behaviour. Cards animate in pure CSS off `--why-p` with per-card `--start` (L/R alternating 0.14…0.54): opacity, drift, scale, blur. **Sticky gotcha:** `.fl-why` was `overflow:hidden` (a scroll container, kills sticky) → `overflow:clip`. Stage is height-led ÷1.06 so the ~5% explode scale clears the nav. ≤900px: no pin; the product panel itself is sticky under the nav with a solid purple background (fade only in the extra 44px below) and cards scroll beneath it; `data-stuck` (set from track top vs the panel's sticky `top`) fills the nav gap only while pinned. Reduced motion: no pin, exploded frame, all visible. BENEFITS copy untouched. |
| 2026-09-14 | **/blog "The latest" → pinned-note journal (frontend only)** | `screens/Blog.tsx` · `components/BlogCards.tsx` · `styles/blog.css` (appended block) | Grid replaced by one column of `.bnote` wrappers, each with a thread + gold pin around the unchanged `ArticleCard` (optional `coverSizes` prop added — default output identical, so BlogPost's "Keep reading" is untouched). Scroll-linked, never pinned: Blog.tsx sets `--r` 0→1 per note from its top vs viewport (96%→46%), re-run on filter change; CSS stages thread `--t`, pin `--p`, paper `--c` (fade, rise, scale, settle into alternating `--tilt` pivoting on the pin, `translate` ±shift). `var(--r,1)` = shown without JS / with reduced motion. Row card ≥901px, column ≤900, centred ≤560. **Gotcha:** ScrollMotion auto-tags `main`'s blocks and reveals by visible *share*; the ~6.8k px section never qualified on a phone and stayed `opacity:0` (not even the 4s failsafe) — so `data-no-reveal` is on the `<section>`, not just the grid. Any section made that tall needs the same. Content verified identical (12 cards, 7 chips). |
| 2026-09-14 | **Home Journal strip → cards pinned on a thread (static)** | `screens/Home.tsx` (Journal markup) · `styles/craft-home.css` (appended block) | Each `.fl-blog` link wrapped in `.fl-journal__note` with a gold `.fl-journal__pin`; one draped SVG `.fl-journal__thread` (absolute, out of grid flow, `vector-effect:non-scaling-stroke`) passes through the pins at the column centres. Cards get a paper border and a tilt pivoting on the pin. **No entrance animation:** the Figma parking offsets (`.fl-blog:nth-child(n)` translateY 610–1233px, opacity 0 until `data-visible`) are overridden — note the link is now `nth-child(2)` of its note, so those base rules still match and MUST stay overridden. Heading made static too; hover shade/shadow kept. ≤900px: shared thread hidden, each note draws its own via `::before`; tilt restated `!important` against the mobile reveal safety net's `transform:none !important`. Also fixed a pre-existing overflow: the Figma grid was three fixed 429px columns (1352px) at every desktop width, so below ~1440px the third card ran off-screen — now `left/right:80px` (48px ≤1180) with `repeat(3,minmax(0,1fr))`, and `.fl-blog__photo--dynamic` fills its card (placeholder crops untouched). 901–1140px: grid `top:372px` (was 324) — below ~1100px the h2 wraps to two lines, the absolute heading ends ~328px and the thread (~313px) ran through the subtitle; heading and grid are both absolutely positioned, so any copy change that makes the heading taller needs this re-measured. Content verified identical. |
| 2026-09-14 | **Periods Wall feed → layered story carousel (frontend only)** | `screens/PeriodsWall.tsx` · `styles/periods-wall.css` (appended block) | Vertical list replaced by one centred, sharp story with blurred, faded, scaled neighbours. All slides share one grid cell (height = tallest story); `offsetOf(i)` = wrapped signed distance from `centre`, clamped ±2 → `--off` + `data-state` centre/side/hidden, and CSS transitions transform/filter/opacity between states. `active` is UI state only, reset on filter change. Side slides' card wrapper is `inert` (their like buttons unreachable); an invisible `.pw-slide-hit` button over each side card brings it forward. Prev/next, `n / total`, ArrowLeft/Right on the focusable region, touch swipe. `PostCard`, likes, filters and empty states untouched; content verified identical, like still POSTs. Mobile: 86% slides, sides at 0.3 opacity. Reduced motion: no transitions. |
| 2026-09-14 | **Periods Wall: compose left, stories right (frontend only)** | `screens/PeriodsWall.tsx` (wrapper div) · `styles/periods-wall.css` (appended block) | Filters + like error + feed wrapped in `.pw-stories`. ≥980px `.pwall-body-wrap` is a two-column grid (`0.9fr` compose · `1.1fr` stories), `align-items:stretch` so both columns share one height: compose is a flex column whose `.pw-textarea` grows into spare height, stories is a flex column whose feed centres the carousel below the filters. Carousel sized to the column (`--shift:58%`, slides `min(520px,86%)`). To leave no blank bands the carousel is a flex column filling the stories column (nav on its foot), the stage is `grid-template-rows:minmax(0,1fr)` + `align-items:stretch`, and each slide → `.pw-slide-card` → `.pw-card` is a flex chain so the card itself fills the stage height, with `.pw-body{margin-block:auto}` centring the text. Filters tightened (36px chips). Below 980px stacks exactly as before. **Swipe (same day):** stage pointer handlers (mouse + touch) set `dragX`; a drag only starts after 8px, and pointer capture is taken only then, so a plain click still reaches the like button / side-card hit button (capturing on pointerdown would retarget that click to the stage). CSS: `--drag` + `data-dragging` → centre follows with a slight tilt, sides drift 0.35×; release past min(70px, 25% card) calls `go()`, else springs back via an overshoot transition. **Cascade gotcha:** that release transition rule silently re-enabled transitions during drag (equal specificity, later source) and the card lagged the pointer — the `.is-swipeable[data-dragging]` rule exists to out-specify it; keep it last. Verified at 1440/1100 (side by side, equal height, carousel still rotates), 820/390 stacked, content identical, no overflow. |
| 2026-09-14 | **Hydration warning on `<html>` from a browser extension** | `app/layout.tsx` | Console error "A tree hydrated but some attributes… didn't match" diffing `<html>`: QuillBot stamps `data-qb-installed` (and a lowercase `suppresshydrationwarning`) onto `<html>` before React hydrates. Not a code bug — added `suppressHydrationWarning` to `<html>`, matching the existing one on `<body>`. It is one level deep: only this element's attributes are ignored, page-content mismatches still report. Verified by stamping the same attributes before hydration on /, /shop, /periods-wall, /blog (0 errors); a control stamping unsuppressed `<main>` still raises the error, so the check is real. |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
| 2026-09-14 | **/partner hero: copy left, count-up stats right (frontend only)** | `screens/Partner.tsx` · `styles/partner.css` (appended block) | Hero is now `.pt-hero-grid` (1.08fr copy · 0.92fr stats, single column ≤960px). The STATS band under the hero (`.pt-stats-wrap`) was removed and the same four stats render in the hero as a 2×2 card set (`.pt-hero-stats`, first card on plum). `CountUp` counts every number in a stat from 0 once on view (rAF, quartic ease-out, 1.8s, staggered 140ms; both ends of "Rs.8,000–20,000"), always finishing on the exact original string; an invisible ghost copy reserves the width, a `.pt-sr` copy is the only thing screen readers read, reduced motion shows the final value. Copy unchanged. |
| 2026-09-14 | **/partner hero stats → wide rectangular cards (frontend only)** | `styles/partner.css` (appended blocks) | The 2×2 near-square stat cards became wide rectangles: each `.pt-hero-stats .pt-stat` is a 2-column grid (number 58% · label), no min-height, and the gold rule is a short vertical accent on the left edge. Desktop stacks the four in the right column; 461–960px is 2×2 (number column 62%, smaller size so Rs.8,000–20,000 fits); ≤460px stacks them. Numbers are `white-space: nowrap`. Count-up and copy unchanged. |
| 2026-09-14 | **/partner "How it works" → pinned cards on a thread (frontend only)** | `screens/Partner.tsx` (`PinnedSteps`, `PushPin`, `threadPath`) · `styles/partner.css` (appended block) | Same STEPS content (number, title, description; DOM order unchanged). Grid-paper `.pt-board`; each step is a tilted plum card (`--tilt` −5/4/−3/5°, even cards dropped) with a white inset panel for number + description and the title in the plum strip below (CSS grid areas). `PinnedSteps` measures `.pt-pin-anchor` in each card after the tilt (ResizeObserver, resize, fonts, transition/animation end), draws one sagging SVG thread through the pin necks and places glossy SVG push-pins (domed cap, waisted body, steel needle, blurred cast shadow) above the cards. Cards no longer lift on hover (thread is tied to them). 2×2 ≤960px, zigzag single column ≤640px. |
| 2026-09-14 | **Home partner section redesign (redesign-existing-projects skill; frontend only)** | `screens/Home.tsx` (`Partner`, `PARTNER_STATS`, `PartnerArrow`) · `styles/home-partner.css` (new, imported by Home.tsx) | Moved off the Figma `.fl-partner*` rules (fixed heights, absolute columns, stacked !important overrides) onto a scoped `.f9-partner` block; copy, links (`/partner#apply`, `/partner#how`) and photo unchanged; decorative ribbon SVG dropped. Newsreader headline (tight tracking, balance), lede capped ~50ch, stats as a semantic `<dl>` ledger (hairline rules, tabular figures, figure shown before label via `order`), gold CTA with arrow nudge + underlined text link (hover/active/focus states), grain + lilac glow field, photo on a tilted plate with plum-tinted shadow, staggered entrance on Reveal's `data-visible`, reduced-motion respected. Single column ≤900px; stacked actions ≤520px. |
| 2026-09-14 | **/about founders section → copy left, layered founder cards right (frontend only)** | `screens/About.tsx` · `styles/about-founders.css` (new, imported by About.tsx) | Moved off the Figma `.fl-about*`/`.fl-founder*` artboard rules onto a scoped `.f9-about` block. Copy (kicker, headline, both paragraphs, Know More → /periods-wall) unchanged, now in the left column. Right column is a layered stage like the reference: deep plum backdrop with leaf glows, three tilted cards (founder on top, co-founders overlapping below; `--x/--y/--w/--tilt` per card), each with a concave top-right notch (mask) and the person's existing name + role label. Co-founder captions sit on a bottom scrim; the founder's caption is a frosted chip at top-left because her card's lower edge is covered. Hover lifts and straightens a card; staggered entrance on Reveal's `data-visible`; reduced motion respected. Decorative Figma shapes and hover arrows removed (and their `useMediaGate` gates). Stacked ≤900px. `<figcaption>` is a direct child of `<figure>`. Backup: scratchpad `about-backup/`. |
| 2026-09-14 | **/about founder cards: no background, plain rectangles (frontend only, follows the row above)** | `screens/About.tsx` · `styles/about-founders.css` | Removed the plum backdrop panel and leaf shapes (markup + rules + entrance) and the concave top-right notch masks: the three founder cards are now plain rounded rectangles layered straight on the page field (tilt and overlap kept). Phones (≤520px): stage aspect 0.78, co-founder cards lowered so the founder's bottom caption stays visible (frosted top chip is desktop/tablet only). |
| 2026-09-14 | **/about founder cards → straight landscape rectangles in a cascade (frontend only, supersedes the card styling in the rows above)** | `styles/about-founders.css` (rewritten) | Cards are now untilted 4:3 landscape rectangles (radius 10px, 60% of a square stage; 66% on phones): founder top-left (z3), Vignesh Shivan stepped down-right (z2), Nayanthara stepped down-left (z1). Upper cards overlap only the top corner of the card below, so every bottom name + role caption stays uncovered — the founder's frosted top chip and the phone-only spacing overrides are gone. Hover lifts a card; entrance and copy unchanged. |
| 2026-09-14 | **Home partner section: photo removed, counting stats on the right (frontend only)** | `screens/Home.tsx` (`Partner`) · `styles/home-partner.css` (rewritten) · `components/CountUp.tsx` + `CountUp.css` (new; used by Home only — /partner keeps its own copy) | Photo and tilted plate removed. Layout is two equal columns: headline, lede and actions left; the four stats right as a 2×2 panel (hairline dividers, gold rule per cell, large tabular Newsreader figures) that count up once via `CountUp` (rAF, quartic ease-out, staggered 140ms) and always finish on the exact strings. Copy and links unchanged. Single column ≤900px (stats under the actions). Backup: scratchpad `home-partner-backup-v3/`. |
| 2026-09-14 | **Home partner stats → tilted review-style cards, lavender + blue (frontend only)** | `screens/Home.tsx` (`PARTNER_ICONS`, icon in each `<dt>`) · `styles/home-partner.css` | The 2×2 stats panel became a vertical stack of wide rounded cards like the reference review cards: alternating lavender gradient / white, tilted −2° / +1.6° with the `rotate` property (the unchanged `f9PartnerUp` entrance still owns `transform`), a blue (#352D78) icon disc + bold label on the left, the counting figure in a pill on the right (white pill on lavender cards, lavender pill on white). Icons are decorative (`aria-hidden`) and sit inside `<dt>` so the `<dl>` stays valid. CountUp timing, copy and links unchanged. Backup: scratchpad `home-partner-backup-v4/`. |

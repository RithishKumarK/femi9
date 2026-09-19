# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**This is a standalone preview build, not the production app.** It was extracted
from `apps/femi9-web` inside the `femi9-platform` monorepo and separated from
the two workspace packages it normally depends on: `@femi9/core` (all
server-side business logic) and `@femi9/db` (Prisma schema + client). Neither
exists here. In their place, [`stubs/`](stubs/) provides local stand-ins wired
through the `paths` block in [`tsconfig.json`](tsconfig.json).

Read [`README.md`](README.md) and [`stubs/README.md`](stubs/README.md) before
touching data flow — they explain exactly what is real and what is fixture.

**Rules for the stubs, non-negotiable:**
- `stubs/core/services/*` (catalogue, journal, wall, settings) are backed by
  **in-memory fixtures**, not Postgres. The cart is a real, working cart, but
  it lives in a module-level `Map` that dies with the dev server restart.
- Anything that moves money, sends a message, signs a session, or reads a real
  customer row calls `unavailable()` and throws — it does **not** pretend to
  succeed. Never "fix" one of these by making it return a fake `{ ok: true }`;
  a stub that silently succeeds is worse than one that visibly fails. This is
  why sign-in, `/account`, `/dashboard`, checkout completion, subscriptions,
  refunds, OTP, and WhatsApp do not work in this build — that's by design.
- Prices are still integer rupees, resolved as if server-side, even though the
  fixture catalogue has no price zones — keep that pattern so no caller learns
  to skip the step.
- `stubs/` and the `tsconfig.json` `paths` block are the *entire* wiring for
  this separation. If the real `packages/core` and `packages/db` ever become
  available beside this app again, delete both together — nothing else in the
  app was changed to accommodate the stubs.

**Typechecking is intentionally broken for the signed-in surface.**
`next.config.mjs` sets `typescript.ignoreBuildErrors: true` because the stubs
reproduce runtime behavior but not the full type surface of the ~60 Prisma
models the signed-in screens' DTOs are shaped by. `npm run typecheck` still
reports ~320 errors in code that's unreachable while signed out — don't try to
zero that out, and don't be alarmed by it when touching public storefront code.

`onVercel` in `next.config.mjs` toggles two settings that exist only for the
ECS/Docker deploy of the *real* app and are actively wrong here on Vercel —
they're switched off, not deleted, in case this tree is ever merged back.

## Commands

```bash
npm install
npm run dev          # next dev — Turbopack, http://localhost:3000
npm run build
npm start
npm run typecheck    # tsc --noEmit — expect ~320 pre-existing errors, see above
npm test             # vitest run
npm run test:watch
npm run test:ui      # playwright
```

No environment variables are required to run this preview — the stubs replace
every external dependency. `.env.example` documents the vars the *real* app
needs; only set `NEXT_PUBLIC_SITE_URL` here if you need absolute OG/canonical
URLs.

`prisma/*.ts` (seed.ts, seed-zones.ts, seed-demo.ts) are leftover seed data
scripts from the monorepo; there is no schema or migration here to run them
against.

## Layout

```
app/
  (store)/          storefront: home, shop, product/[id], checkout, blog, thara, ...
  account/ dashboard/ welcome/   signed-in customer surface (throws via stubs)
  api/               route handlers
  a/[code] r/[code]  affiliate + Thara referral short links
src/
  lib/               client-side helpers: router-compat, track, session,
                     sticky-nav, opt-images, safe-next, size-run, mandate, motion
  data/              storefront fixture content (blog, product detail/benefits, videos)
  components/ screens/ store/ styles/ charts/ immersive/
stubs/
  core/              stand-ins for @femi9/core, import-path-compatible
  db/                stand-in for @femi9/db
middleware.ts        edge guard for /account, /dashboard, /welcome only
                     (there is no /admin surface in this app at all)
```

Import from stubs the same way real code imports from the workspace packages —
by subpath, no barrel:

```ts
import { ok, badRequest, handle } from '@femi9/core/api'
```

## Rules that matter here

**CSS, not Tailwind.** Hand-written CSS in `src/styles/*.css` plus colocated
`*.css` per component. Shared tokens live in `src/styles/base.css` / `app.css`;
`craft-*.css` is the current design system for most pages.

**Two cookies, two audiences, never crossed.** `femi9_session` (audience
`femi9-customer`) is the only session type. `middleware.ts` re-implements JWT
verification inline with Web Crypto because it runs on the edge and cannot use
Node-only crypto; the same check exists again for the Node runtime. If you
change one, change the other.

**Guard twice.** Middleware is the first gate, not the only one — pages under
`/account`, `/dashboard`, `/welcome` still need to check the session
server-side, since the edge check alone is not authorization.

**`middleware.ts`, not `proxy.ts`, is intentional.** Next 16 renamed the
convention and the build warns about it. This file is kept because it must
stay edge-compatible; migrating to `proxy` (Node-only) is a real decision that
hasn't been made, not an oversight. Don't silence the warning by running the
codemod.

**There is no ESLint.** No config exists, `next lint` was removed in Next 16,
and `next build` no longer lints. The `lint` script was removed rather than
left pretending to work.

**Size picker changes the URL.** Each pad length is a distinct product; size
chips are `<Link>`s to sibling products derived at runtime from the catalogue
(`src/lib/size-run.ts`), never hardcoded. Pack/variant selection for period
underwear resolves server-side via `?size=` — a `useSearchParams` read would
paint the wrong default first and correct it after hydration.

**Reveal/entrance animations follow a `data-visible` / `data-reveal` contract**
(`ScrollMotion`, `Reveal`) — CSS hides only what JS has tagged, so a failed
bundle leaves content visible rather than blank. A section taller than the
viewport by a lot needs `data-no-reveal` or it may never cross the visibility
threshold that arms it (see the `/blog` and Journal entries in git history if
you hit this).

## Task history

This checkout's own git history is shallow (a couple of commits) and doesn't
carry the detailed per-change reasoning from the monorepo this was extracted
from. If a CSS or animation choice looks arbitrary, it likely isn't — check
whether the same component/gotcha is documented in the monorepo's
`apps/femi9-web/CLAUDE.md` task log before changing it, if you have access to
that repo.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

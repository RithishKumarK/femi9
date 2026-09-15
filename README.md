# Femi9 — storefront preview

The Femi9 storefront (Next.js 16 App Router, React 19, hand-written CSS),
published so the site can be opened and clicked through without setting
anything up.

**This is a preview build, not the production application.** It is a standalone
copy of `apps/femi9-web` from the `femi9-platform` monorepo, separated from the
two workspace packages it normally depends on — `@femi9/core` (all server-side
business logic) and `@femi9/db` (the Prisma schema and client). Those are not
here, so their modules are reproduced as local stand-ins under [`stubs/`](stubs/).

## What works

The whole public storefront, served from fixture data:

| | |
| --- | --- |
| Home | Hero, product rail, cycle tracker, journal teaser |
| `/shop` | Full catalogue with the filter + sort rail |
| `/product/[id]` | Gallery, pack/size picker, key benefits, specs, reviews |
| `/blog`, `/blog/[slug]` | The real journal articles |
| `/periods-wall` | Reads and accepts new stories |
| `/checkout` | Renders a priced order summary |
| Cart | Add, change quantity, remove — server-priced, persists per visitor |

The cycle tracker on the home page runs real arithmetic, not a mock.

## What does not

Anything that needs a database, a payment gateway or a messaging provider:
signing in, `/account`, `/dashboard`, placing an order, subscriptions, refunds,
OTP and WhatsApp. Those call sites throw a clearly-named error rather than
returning a fake success — a stub that pretended `placeOrder` had worked would
be worse than no stub at all.

The storefront is designed around the signed-out visitor, so every public
surface renders correctly regardless.

## Running it

No environment variables are required — the stubs replace every external
dependency.

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

Optionally set `NEXT_PUBLIC_SITE_URL` to the deployed origin so Open Graph and
canonical URLs are absolute.

## Notes for anyone picking this up

* `stubs/` and the `paths` block in [`tsconfig.json`](tsconfig.json) are the
  entire wiring. Delete them together when the real `packages/` are available;
  nothing else in the app was changed to accommodate them.
* `typescript.ignoreBuildErrors` is set in [`next.config.mjs`](next.config.mjs)
  for the same reason and with the same lifetime: the stubs reproduce each
  module's runtime behaviour but not its full type surface, and the signed-in
  screens read DTOs shaped by Prisma models that are not in this copy.
  `npm run typecheck` still reports them.
* Prices are integer rupees and are resolved server-side. That rule is kept in
  the stubs even though the fixture catalogue has no price zones, so no caller
  learns to skip the step.

See [`stubs/README.md`](stubs/README.md) for what each stand-in does and why.

# @femi9/db

The shared Prisma schema and the per-brand clients built from it.

```ts
import { dbFor, isBrand, type Brand } from '@femi9/db'

const db = dbFor('femi9')
const orders = await db.order.findMany()
```

## One schema, one client per brand

`prisma/schema.prisma` is the single definition for both brands. Isolation lives
in the connection string, not in a `where` clause: each brand's client is bound
to its own Postgres schema, so a Femi9 query cannot reach a Lumi9 row.

```
DATABASE_URL_FEMI9="postgresql://…/app?schema=femi9"
DATABASE_URL_LUMI9="postgresql://…/app?schema=lumi9"
```

**`DATABASE_URL` is still honoured for Femi9 as a transitional fallback.** The
live data is in the `public` schema and nothing has been renamed yet — Phase 2
does that. Lumi9 has no fallback on purpose, so it can never silently borrow
Femi9's database.

## Brand is untrusted input

`isBrand()` has no default. Anything arriving from a request — a query param,
the admin login's brand toggle — must be narrowed through it. Brand itself must
come from the session or the host, never from a body a caller controls.

## Migrations

The schema is shared, so migrations run once per brand database. Seeds are NOT
here: seed data is brand-specific and lives with each app (see
`apps/femi9-web/prisma/`).

```bash
npm run db:generate      # from the repo root
npm run db:migrate
```

Both delegate to `apps/femi9-web`, which is where `.env` lives — the Prisma CLI
reads env from its working directory, so it runs there and points at this
schema with `--schema`.

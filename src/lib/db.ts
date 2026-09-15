import { dbFor, type Brand } from '@femi9/db'

/**
 * Femi9's Prisma client, for the handful of places in THIS app that still query
 * Prisma directly instead of going through a service.
 *
 * It lives here, not in @femi9/core, and that is the point. Pinning a brand is a
 * legitimate choice for a single-brand app; it is a footgun inside a package the
 * admin console and Lumi9 also import, where a caller could read Femi9's data
 * believing it was reading its own. Core no longer exports a client at all —
 * every service there takes `brand` and calls `dbFor(brand)`.
 *
 * The remaining importers are route handlers and pages doing their own queries,
 * which the architecture says belongs in a service (see CLAUDE.md). Each one
 * moved into `packages/core` is one fewer file here.
 *
 * ── Why the Proxy ──────────────────────────────────────────────────────────
 * It is deliberately LAZY. `dbFor()` takes an explicit `datasourceUrl`, so it
 * needs `DATABASE_URL` present at construction — and the Docker build stage has
 * no database credentials at all (they are injected at deploy time from Secrets
 * Manager). Constructing eagerly would throw during `next build` inside the
 * image. Deferring to first property access keeps the build credential-free
 * while every real call site still gets a client.
 */
const BRAND: Brand = 'femi9'

let client: ReturnType<typeof dbFor> | undefined

export const prisma = new Proxy({} as ReturnType<typeof dbFor>, {
  get(_target, property) {
    client ??= dbFor(BRAND)
    // `client` as the receiver, so methods keep their own `this` rather than
    // binding to the empty proxy target.
    return Reflect.get(client, property, client)
  },
})

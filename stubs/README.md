# `stubs/` — local stand-ins for `@femi9/core` and `@femi9/db`

This folder exists so the **storefront front end can be run and looked at from
this standalone copy of `apps/femi9-web`**, which was separated from the
`femi9-platform` monorepo and therefore has neither `packages/core` nor
`packages/db` beside it.

It is NOT a port of the real packages and must never be treated as one:

* `services/*` that read the catalogue, the journal, the wall and the settings
  are backed by **in-memory fixtures**, not Postgres.
* The cart is a real, working cart — but it lives in a module-level `Map` that
  dies with the dev server.
* Everything that moves money, sends a message, signs a session or reads a real
  customer row throws `unavailable()` instead of pretending to succeed. A stub
  that silently returns `{ ok: true }` for `placeOrder` would be worse than no
  stub at all.

Wiring is one `paths` block in `tsconfig.json`. Delete that block and this
folder together the moment the real `packages/` are available.

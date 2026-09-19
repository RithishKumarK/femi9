import path from 'node:path'
import { withSentryConfig } from '@sentry/nextjs'

const productionCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.razorpay.com https://*.ingest.sentry.io",
  "frame-src https://*.razorpay.com",
  'upgrade-insecure-requests',
].join('; ')

/**
 * True on Vercel. `packages/core` + `packages/db` + `packages/db-platform`
 * (workspace packages, cherry-picked from the femi9-platform monorepo) live
 * beside this app under `packages/`, providing the real Prisma-backed
 * services. `outputFileTracingRoot`/`output: 'standalone'` below still exist
 * for the ECS/Docker deploy and are actively wrong on Vercel, so they stay
 * switched off there.
 */
const onVercel = process.env.VERCEL === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Trace from the WORKSPACE root, not this app. npm workspaces hoist most of
  // the dependency tree to `<repo>/node_modules`, so a trace rooted at the app
  // would miss those files and the standalone bundle would boot with modules
  // missing. Rooting here also means `output: 'standalone'` emits under
  // `.next/standalone/apps/femi9-web/` — the Dockerfile's runner stage and its
  // CMD path both assume that layout.
  // On Vercel the deployment root IS this directory, so tracing from `../..`
  // would point outside it and prune files the server needs.
  ...(onVercel ? {} : { outputFileTracingRoot: path.join(import.meta.dirname, '..', '..') }),
  // The three.js / R3F stack ships ESM that Next needs to transpile.
  // @femi9/db and @femi9/core are workspace packages published as TypeScript
  // source (see packages/core/package.json, packages/db/package.json) — Next
  // needs to transpile them the same way it does the three.js stack.
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei', '@femi9/db', '@femi9/core'],

  // The ops console moved to its own app. Old bookmarks and any stray /admin
  // link should land there rather than 404. Only wired when the console's URL
  // is configured, so a deploy without it simply has no /admin route at all
  // rather than redirecting into nowhere.
  async redirects() {
    const consoleUrl = process.env.ADMIN_CONSOLE_URL
    if (!consoleUrl) return []
    return [
      { source: '/admin', destination: `${consoleUrl}/femi9`, permanent: false },
      { source: '/admin/:path*', destination: `${consoleUrl}/femi9/:path*`, permanent: false },
    ]
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '0' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Content-Security-Policy', value: productionCsp }]
            : []),
        ],
      },
    ]
  },

  // Emit a self-contained production server for containerized deploys (ECS Fargate).
  // With this, `next build` writes `.next/standalone/server.js` plus a *minimal*,
  // Node-file-trace-pruned `node_modules` — so the runtime image does not need the
  // full dependency tree, `npm start`, or the source. The Dockerfile launches it with
  // `node server.js`.
  //
  // IMPORTANT: standalone does NOT copy `public/` or `.next/static/` into the
  // standalone folder — those must be copied into the image alongside it. The
  // Dockerfile handles this (see the runner stage).
  // Vercel builds its own serverless output and documents `standalone` as
  // unnecessary there; leaving it on produces a second, unused bundle.
  ...(onVercel ? {} : { output: 'standalone' }),
}

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
})

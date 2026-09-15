#!/usr/bin/env node
/**
 * Idempotently create/update one active product, then prove the storefront
 * serves it.
 *
 * It used to do this through the admin API. That API moved to `apps/admin`
 * when the console became a separate two-brand app, so the seed now calls the
 * SAME services the console's routes call — one less hop, and no cross-app
 * dependency in the storefront's own end-to-end setup. The public verification
 * below is still real HTTP, because that is the part being tested.
 *
 * Local:
 *   E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:seed-product
 *
 * Writing anywhere non-local needs an explicit opt-in:
 *   ALLOW_PRODUCTION_SEED=true E2E_BASE_URL=https://example.com npm run e2e:seed-product
 *
 * The product slug and SKUs are stable, so reruns update instead of duplicating.
 */
import {
  listAdminProducts,
  getAdminProduct,
  createProduct,
  updateProduct,
} from '@femi9/core/services/admin/products'

const BRAND = 'femi9' as const

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)

if (!isLocal && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  throw new Error(
    `Refusing to write to non-local URL ${baseUrl}. Set ALLOW_PRODUCTION_SEED=true to confirm.`,
  )
}

const PRODUCT_SLUG = 'e2e-test-pad'
const PRODUCT_NAME = 'Femi9 E2E Test Pad'

const desiredProduct = {
  name: PRODUCT_NAME,
  slug: PRODUCT_SLUG,
  type: 'pad',
  basePrice: 199,
  meta: '6 pads · 290mm',
  flow: 'Regular · Test',
  description: 'A clearly labelled test product for storefront, cart, and checkout verification.',
  longDescription:
    'This product is created by the Femi9 end-to-end seed script. It can be updated safely by rerunning the script.',
  tag: 'E2E Test',
  status: 'active',
  images: ['/assets/img/prod-290-large9.webp'],
  variants: [
    {
      kind: 'pack',
      label: '3 pcs',
      packCount: 3,
      size: null,
      price: 109,
      sku: 'E2E-PAD-3',
      stock: 100,
      active: true,
    },
    {
      kind: 'pack',
      label: '6 pcs',
      packCount: 6,
      size: null,
      price: 199,
      sku: 'E2E-PAD-6',
      stock: 100,
      active: true,
    },
  ],
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { accept: '*/*' } })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON — the homepage check wants the raw HTML */
  }
  return { status: res.status, body }
}

function assertStatus(actual: number, expected: number, label: string, body: unknown) {
  if (actual !== expected) {
    const detail = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)
    throw new Error(`${label}: expected HTTP ${expected}, got ${actual}. ${detail}`)
  }
}

async function main() {
  const products = await listAdminProducts(BRAND)
  const existing = products.find((p) => p.slug === PRODUCT_SLUG)

  let action: string
  let id: string | undefined

  if (existing) {
    // Reuse the existing variant ids by SKU so a rerun updates rows rather than
    // stacking duplicates beside them.
    const detail = await getAdminProduct(BRAND, existing.id)
    const bySku = new Map(
      (detail?.variants ?? []).filter((v) => v.sku).map((v) => [v.sku as string, v]),
    )
    const updated = await updateProduct(BRAND, existing.id, {
      ...desiredProduct,
      variants: desiredProduct.variants.map((v) => ({ ...v, id: bySku.get(v.sku)?.id })),
    } as never)
    action = 'updated'
    id = updated?.id ?? existing.id
  } else {
    const created = await createProduct(BRAND, desiredProduct as never)
    action = 'created'
    id = created?.id
  }

  // From here it is the storefront being checked, so it stays over HTTP.
  const catalog = await get('/api/products')
  assertStatus(catalog.status, 200, 'Public product list', catalog.body)
  const list = catalog.body as Array<{ id?: string; variants?: unknown[] }> | null
  const publicProduct = Array.isArray(list) ? list.find((p) => p.id === PRODUCT_SLUG) : null
  if (!publicProduct) throw new Error('The active test product is missing from /api/products.')
  if (!publicProduct.variants?.length) throw new Error('The test product has no purchasable variants.')

  const home = await get('/')
  assertStatus(home.status, 200, 'Storefront homepage', home.body)
  if (typeof home.body !== 'string' || !home.body.includes(PRODUCT_NAME)) {
    throw new Error('The test product is in the API but missing from the server-rendered homepage.')
  }

  console.log(
    JSON.stringify(
      { ok: true, action, id, slug: PRODUCT_SLUG, productPage: `${baseUrl}/product/${PRODUCT_SLUG}` },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

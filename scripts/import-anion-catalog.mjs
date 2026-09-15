/**
 * Import the Anion pack lineup into an environment, and archive the lineup it
 * replaces.
 *
 * Everything a human admin could do is done THROUGH THE ADMIN CONSOLE'S OWN
 * ENDPOINTS, over HTTPS, against the running app:
 *
 *   POST   /api/admin/login          → the femi9_admin session cookie
 *   POST   /api/admin/upload         → one image; the app writes it to S3
 *                                      (UPLOADS_BUCKET is set on the ECS task)
 *                                      and returns the /uploads/<key> URL
 *   POST   /api/admin/products       → create, with its ordered image list
 *   PATCH  /api/admin/products/:id   → update, on a re-run
 *   DELETE /api/admin/products/:id   → archive (soft delete; order history kept)
 *
 * So the rows, the S3 keys and the URL shape are exactly what the console
 * produces — nothing here writes a product field the console cannot write, and
 * no product content lives in the app's source.
 *
 * The ONE exception is ProductFeature / ProductSpec. Those tables have no write
 * path in the console at all (`_form.tsx` and the products API never mention
 * them — the editor only reads them back), yet the PDP resolves its Key Benefits
 * panel and its specs table from them. They are therefore inserted directly,
 * over the database URL, in a clearly separated final phase. Everything before
 * that phase is console-equivalent.
 *
 * Secrets are read from AWS Secrets Manager through the AWS CLI, inside this
 * process — they are never echoed, written to disk, or passed on a command line.
 *
 * Idempotent: a product whose slug already exists is PATCHed, never re-created,
 * so a second run cannot leave `-2` slugs or duplicate galleries behind.
 *
 * Run:
 *   node scripts/import-anion-catalog.mjs            # staging, dry run
 *   node scripts/import-anion-catalog.mjs --apply    # staging, for real
 */
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// ───────────────────────────── Environment ─────────────────────────────

const APPLY = process.argv.includes('--apply')

const ENVIRONMENTS = {
  staging: {
    site: 'https://d24too9me3angh.cloudfront.net',
    awsProfile: 'femi9-staging',
    awsRegion: 'ap-south-1',
    secretPrefix: 'femi9-staging',
  },
}

const ENV = ENVIRONMENTS[process.env.TARGET_ENV ?? 'staging']
if (!ENV) throw new Error(`Unknown TARGET_ENV: ${process.env.TARGET_ENV}`)

/** Photo sets, as delivered. */
const SOURCE_ROOT = path.resolve(
  import.meta.dirname,
  '../../Images',
)

/** Slugs of the lineup being replaced. Archived, never deleted: a variant that
 *  an order or a cart still references cannot be removed, and the history is
 *  worth more than the row. `ppanty` is deliberately NOT here — Period Panties
 *  stays active. */
const ARCHIVE_SLUGS = ['p330dw', 'p290l9', 'p330cw', 'p290l3', 'p180m9']

// ────────────────────────────── The catalog ──────────────────────────────
//
// Every scalar below is transcribed from the pack artwork in the photo sets:
// the size, the piece count, the day/night marking, the "ultra-thin soft cotton
// finish" line, and the anion / FAR-IR magnetic / nano silver / chitin actives.
//
// PRICES: Rs.75 (320mm trial) and Rs.99 (combo) are printed on the packs. Rs.99
// for the 180mm 30-pack carries over from the row it replaces. The remaining
// three are PROVISIONAL placeholders at a round per-pad rate, to be corrected in
// the admin console — they are not printed on any pack.
//
// `tagClass` (the pink trial-pack pill) is absent on purpose: the column exists
// but the admin console has no field for it, so setting it here would be a
// product field no admin could ever reproduce.

const PRODUCTS = [
  {
    dir: '280mm',
    slug: '280mm-large-12',
    name: 'Femi9 Anion 280mm Pads (Large)',
    basePrice: 180, // PROVISIONAL — Rs.15/pad
    provisionalPrice: true,
    meta: '12 pads · 280mm',
    flow: 'Regular · Night + Day',
    tag: 'Bestseller',
    description:
      'Ultra-thin soft cotton finish pads with a special anion strip, sized for regular flow day and night.',
    longDescription:
      'The everyday Femi9 large. A 280mm ultra-thin pad with a soft cotton finish top sheet, breathable enough to wear through a full day and absorbent enough to sleep in. The anion strip at its centre helps reduce menstrual discomfort and keeps things fresh, while the FAR-IR magnetic, nano silver and chitin layers work underneath. Eco-friendly, and made to a European technology standard. Twelve pads to a pack.',
    packCount: 12,
    specs: [
      ['Length', '280 mm'],
      ['Pads per pack', '12'],
      ['Wear', 'Night + Day'],
      ['Active layers', 'Anion · FAR-IR magnetic · Nano silver · Chitin'],
      ['Top sheet', 'Ultra-thin soft cotton finish'],
    ],
  },
  {
    dir: '320mm',
    slug: '320mm-xl-10',
    name: 'Femi9 Anion 320mm Pads (XL)',
    basePrice: 199, // PROVISIONAL — Rs.20/pad
    provisionalPrice: true,
    meta: '10 pads · 320mm',
    flow: 'Heavy · Night + Day',
    tag: null,
    description:
      'Extra-long 320mm protection with a soft cotton finish, for heavy flow days and overnight wear.',
    longDescription:
      'When a regular pad is not quite enough. At 320mm the Femi9 XL adds rear coverage where leaks actually happen, so heavy days and long nights stay uneventful. The same ultra-thin soft cotton finish and the same anion strip that helps ease menstrual discomfort, over a core layered with FAR-IR magnetic, nano silver and chitin. Ten pads to a pack.',
    packCount: 10,
    specs: [
      ['Length', '320 mm'],
      ['Pads per pack', '10'],
      ['Wear', 'Night + Day'],
      ['Active layers', 'Anion · FAR-IR magnetic · Nano silver · Chitin'],
      ['Top sheet', 'Ultra-thin soft cotton finish'],
    ],
  },
  {
    dir: 'combo',
    slug: 'combo-pack-6',
    name: 'Femi9 Anion Pads (Combo Pack)',
    basePrice: 99, // printed on the pack (MRP Rs.110)
    provisionalPrice: false,
    meta: '6 pads · 280 / 320 / 180mm',
    flow: 'Mixed · Day + Night',
    tag: 'Combo pack',
    description:
      'A full cycle in one pack - three 280mm, two 320mm and one 180mm mini, day and night.',
    longDescription:
      'One pack that covers a whole cycle. Three 280mm pads for regular days, two 320mm for the heavy ones, and a 180mm mini for the tail end - so you are not opening three packets to get through a week. Every pad carries the same anion strip, the same FAR-IR magnetic, nano silver and chitin layers, and the same ultra-thin soft cotton finish. Six pads in total.',
    packCount: 6,
    specs: [
      ['Contents', '3 x 280mm · 2 x 320mm · 1 x 180mm'],
      ['Pads per pack', '6'],
      ['Wear', 'Day + Night'],
      ['Active layers', 'Anion · FAR-IR magnetic · Nano silver · Chitin'],
      ['Top sheet', 'Ultra-thin soft cotton finish'],
    ],
  },
  {
    dir: '410mm',
    slug: '410mm-xxl-5',
    name: 'Femi9 Anion 410mm Pads (XXL)',
    basePrice: 125, // PROVISIONAL — Rs.25/pad
    provisionalPrice: true,
    meta: '5 pads · 410mm',
    flow: 'Heavy · Overnight',
    tag: null,
    description:
      'The 410mm overnight pad - maximum rear coverage for the heaviest nights.',
    longDescription:
      'The longest pad Femi9 makes. 410mm of coverage is built for the nights you would otherwise wake up to check, and for the first two days of a heavy cycle. Still ultra-thin, still a soft cotton finish against skin, with the anion strip and the FAR-IR magnetic, nano silver and chitin layers doing their work underneath. Five pads to a pack.',
    packCount: 5,
    specs: [
      ['Length', '410 mm'],
      ['Pads per pack', '5'],
      ['Wear', 'Night + Day'],
      ['Active layers', 'Anion · FAR-IR magnetic · Nano silver · Chitin'],
      ['Top sheet', 'Ultra-thin soft cotton finish'],
    ],
  },
  {
    dir: '320mm-trial',
    slug: '320mm-trial-3',
    name: 'Femi9 Anion 320mm Pads (Trial Pack)',
    basePrice: 75, // printed on the pack
    provisionalPrice: false,
    meta: '3 pads · 320mm',
    flow: 'Try it · Day + Night',
    tag: 'Trial pack',
    description:
      'Three 320mm pads - the low-commitment way to feel the difference for yourself.',
    longDescription:
      'Three pads, one decision. The trial pack is the full 320mm XL - the same ultra-thin soft cotton finish, the same anion strip that helps ease menstrual discomfort, the same FAR-IR magnetic, nano silver and chitin layers - in a pack small enough to carry and cheap enough to simply try. If it works for you, the ten-pack is waiting.',
    packCount: 3,
    specs: [
      ['Length', '320 mm'],
      ['Pads per pack', '3'],
      ['Wear', 'Day + Night'],
      ['Active layers', 'Anion · FAR-IR magnetic · Nano silver · Chitin'],
      ['Top sheet', 'Ultra-thin soft cotton finish'],
    ],
  },
  {
    dir: '180mm',
    slug: '180mm-mini-30',
    name: 'Femi9 Anion 180mm Mini Pads',
    basePrice: 99, // carried over from the 180mm row this replaces
    provisionalPrice: true,
    meta: '30 pads · 180mm',
    flow: 'Light · Daily freshness',
    tag: null,
    description:
      'Ultra-thin daily wear mini pads for light flow, discharge and spotting.',
    longDescription:
      'Not every day of the month needs a full pad. These 180mm minis are ultra-thin daily wear - light enough to forget you have one on, for light flow, everyday discharge, spotting and the last day of a cycle. Natural, comfortable and breathable, with the anion strip that helps reduce discomfort and balance mood. Thirty to a pack, so a box lasts.',
    packCount: 30,
    specs: [
      ['Length', '180 mm'],
      ['Pads per pack', '30'],
      ['Wear', 'Night + Day'],
      ['Active layers', 'Anion · FAR-IR magnetic · Nano silver · Chitin'],
      ['Top sheet', 'Ultra-thin daily wear mini pad'],
    ],
  },
]

/**
 * The six Key Benefits, per product. `resolveBenefits()` takes the first six DB
 * features, splits them down the middle and assigns each an icon pair, so six
 * is exactly the count the panel is designed around.
 *
 * Claim 1 is the size claim and differs per product; the other five are the
 * pack's own shared copy and are generated, so they cannot drift between SKUs.
 */
const SIZE_CLAIM = {
  '280mm-large-12': [
    '280mm Everyday Coverage',
    'Sized for regular flow, comfortable enough to wear all day and sleep in.',
  ],
  '320mm-xl-10': [
    '320mm Extra Length',
    'Extended rear coverage for heavy days and full nights without a leak.',
  ],
  'combo-pack-6': [
    'Three Sizes, One Pack',
    'Three 280mm, two 320mm and one 180mm mini - a whole cycle covered.',
  ],
  '410mm-xxl-5': [
    '410mm Overnight Length',
    'The longest pad Femi9 makes, for the heaviest nights of a cycle.',
  ],
  '320mm-trial-3': [
    '3-Pad Trial Pack',
    'The full 320mm XL in a pack small enough to simply try out.',
  ],
  '180mm-mini-30': [
    '180mm Ultra-Thin Mini',
    'Light daily wear for discharge, spotting and the tail of a cycle.',
  ],
}

const SHARED_BENEFITS = [
  [
    'Anion Comfort Strip',
    'A special anion strip helps reduce menstrual discomfort and lift mood.',
  ],
  [
    'FAR-IR Magnetic Core',
    'Far-infrared magnetic layers work through the pad for lasting comfort.',
  ],
  [
    'Nano Silver & Chitin',
    'Nano silver and chitin keep the pad fresh and hygienic hour after hour.',
  ],
  [
    'Soft Cotton Finish',
    'An ultra-thin cotton-finish top sheet stays breathable and rash-free.',
  ],
  [
    'Eco-Friendly Napkin',
    'An eco-friendly sanitary napkin built to a European technology standard.',
  ],
]

const featuresFor = (slug) =>
  [SIZE_CLAIM[slug], ...SHARED_BENEFITS].map(([title, body]) => ({ title, body }))

// ───────────────────────────────── Helpers ─────────────────────────────────

const log = (...a) => console.log(...a)

/** Read one Secrets Manager value. Stays inside this process: never printed,
 *  never written to disk, never passed as an argument to another command. */
function secret(name) {
  return execFileSync(
    'aws',
    [
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      `${ENV.secretPrefix}/${name}`,
      '--query',
      'SecretString',
      '--output',
      'text',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, AWS_PROFILE: ENV.awsProfile, AWS_REGION: ENV.awsRegion },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim()
}

/**
 * The photo set for a product, in DISPLAY ORDER.
 *
 * The delivered sets number their slots 1..6, but a few files arrived as
 * `Untitled-<slot>.webp` from the export. The slot number is the ordering key
 * either way, so both spellings are normalised to it and sorted numerically —
 * a plain lexical sort would put `Untitled-2` after `6`.
 */
async function orderedPhotos(dir) {
  const abs = path.join(SOURCE_ROOT, dir)
  const files = await readdir(abs)
  return files
    .filter((f) => f.toLowerCase().endsWith('.webp'))
    .map((f) => {
      const m = f.match(/^(?:Untitled-)?(\d+)\.webp$/i)
      if (!m) throw new Error(`Cannot read a slot number from ${dir}/${f}`)
      return { slot: Number(m[1]), file: f, abs: path.join(abs, f) }
    })
    .sort((a, b) => a.slot - b.slot)
}

class HttpError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url} → ${status} ${body}`)
    this.status = status
  }
}

function makeClient() {
  let cookie = ''

  const call = async (method, route, { json, form } = {}) => {
    const url = `${ENV.site}${route}`
    const res = await fetch(url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(json ? { 'content-type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : form,
    })
    // Capture the session cookie on login.
    const setCookie = res.headers.getSetCookie?.() ?? []
    for (const c of setCookie) {
      if (c.startsWith('femi9_admin=')) cookie = c.split(';')[0]
    }
    const text = await res.text()
    if (!res.ok) throw new HttpError(method, route, res.status, text.slice(0, 400))
    return text ? JSON.parse(text) : null
  }

  return {
    call,
    async login(email, password) {
      await call('POST', '/api/admin/login', { json: { email, password } })
      if (!cookie) throw new Error('Login succeeded but returned no session cookie')
    },
    /** One image, through the console's own upload endpoint → S3. */
    async upload({ abs, file }) {
      const bytes = await readFile(abs)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), file)
      const { url } = await call('POST', '/api/admin/upload', { form })
      if (!url) throw new Error(`Upload of ${file} returned no URL`)
      return url
    },
  }
}

/** The admin payload for a product. Only fields ProductInputSchema accepts. */
const payloadFor = (p, images) => ({
  features: featuresFor(p.slug),
  specs: p.specs.map(([key, value]) => ({ key, value })),
  name: p.name,
  slug: p.slug,
  type: 'pad',
  basePrice: p.basePrice,
  meta: p.meta,
  flow: p.flow,
  description: p.description,
  longDescription: p.longDescription,
  tag: p.tag,
  status: 'active',
  images,
  variants: [
    {
      kind: 'pack',
      label: `${p.packCount} pcs`,
      packCount: p.packCount,
      size: null,
      price: p.basePrice,
      sku: p.slug,
      stock: 200,
      active: true,
    },
  ],
})

// ─────────────────────────────────── Main ───────────────────────────────────

async function main() {
  log(`\nTarget: ${ENV.site}  (${APPLY ? 'APPLY' : 'DRY RUN — pass --apply to write'})\n`)

  // Resolve the photo sets first: a bad filename should fail before we touch
  // anything, not halfway through uploading.
  const sets = new Map()
  for (const p of PRODUCTS) {
    const photos = await orderedPhotos(p.dir)
    sets.set(p.slug, photos)
    log(`  ${p.slug.padEnd(18)} ${photos.length} photos  ${photos.map((x) => x.slot).join(',')}`)
  }

  if (!APPLY) {
    log('\nDry run complete. Nothing was uploaded, created or archived.')
    log('Re-run with --apply to write to the environment.\n')
    return
  }

  const client = makeClient()
  await client.login(secret('ADMIN_EMAIL'), secret('ADMIN_PASSWORD'))
  log('\nSigned in to the admin console.')

  // Existing rows, so a re-run updates instead of creating a duplicate slug
  // (createProduct auto-uniquifies, which would silently produce `-2` slugs).
  const existing = await client.call('GET', '/api/admin/products')
  const bySlug = new Map(existing.map((r) => [r.slug, r]))

  // ── Phase 1: images → S3, then the product, through the console API ──
  const createdIds = new Map()
  for (const p of PRODUCTS) {
    const photos = sets.get(p.slug)
    const urls = []
    for (const photo of photos) {
      urls.push(await client.upload(photo))
    }
    log(`\n${p.slug}: uploaded ${urls.length} images in order`)

    const prior = bySlug.get(p.slug)
    const row = prior
      ? await client.call('PATCH', `/api/admin/products/${prior.id}`, { json: payloadFor(p, urls) })
      : await client.call('POST', '/api/admin/products', { json: payloadFor(p, urls) })
    createdIds.set(p.slug, row.id)
    log(`  ${prior ? 'updated' : 'created'} ${p.name} — Rs.${p.basePrice}${p.provisionalPrice ? ' (PROVISIONAL)' : ''}`)
  }

  // ── Phase 2: archive the lineup this replaces (soft delete) ──
  log('')
  for (const slug of ARCHIVE_SLUGS) {
    const row = bySlug.get(slug)
    if (!row) {
      log(`  archive ${slug}: not present, skipped`)
      continue
    }
    if (row.status === 'archived') {
      log(`  archive ${slug}: already archived`)
      continue
    }
    await client.call('DELETE', `/api/admin/products/${row.id}`)
    log(`  archived ${slug} (${row.name})`)
  }

  // ── Phase 3: confirm the features + specs the API wrote ──
  // These used to need a direct database connection, because the console could
  // read ProductFeature / ProductSpec but never write them. The admin API now
  // accepts both, so they went out with the payloads above — this just proves it
  // for each product rather than trusting the 201.
  log('\nFeatures + specs, as stored:')
  for (const p of PRODUCTS) {
    const row = await client.call('GET', `/api/admin/products/${createdIds.get(p.slug)}`)
    const ok = row.features.length === 6 && row.specs.length === p.specs.length
    log(
      `  ${p.slug.padEnd(18)} ${String(row.features.length).padStart(2)} features, ` +
        `${String(row.specs.length).padStart(2)} specs  ${ok ? 'ok' : 'MISMATCH'}`,
    )
    if (!ok) process.exitCode = 1
  }

  log('\nDone.\n')
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})

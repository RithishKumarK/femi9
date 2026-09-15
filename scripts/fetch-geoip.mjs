#!/usr/bin/env node
/**
 * Download the GeoLite2 databases the geo resolver reads (src/lib/geo/mmdb.ts).
 *
 * Run at IMAGE BUILD TIME, not at runtime. Baking the files into the image gives
 * every Fargate task an identical, immutable database, needs no writable volume,
 * and keeps the container's "no network egress at runtime" property intact — the
 * same reason the Dockerfile ships the Prisma engines rather than fetching them
 * on boot. Refreshing means rebuilding; GeoLite2 publishes on Tuesdays, and the
 * ASN assignments this app actually depends on are stable enough that a weekly
 * CI rebuild is ample.
 *
 *   MAXMIND_LICENSE_KEY=... node scripts/fetch-geoip.mjs
 *
 * WITHOUT A KEY THIS EXITS 0 AND WRITES NOTHING. That is deliberate: the app is
 * built to run with the databases absent (every lookup returns null and the
 * resolver falls back to the CloudFront headers), so a missing key must not break
 * a local build or a contributor's checkout.
 *
 * Licence: GeoLite2 is MaxMind's free tier. It requires a signed-up account and
 * licence key, and it carries attribution terms — read docs/GEOIP.md before
 * shipping these files anywhere public.
 *
 * The archive is unpacked in-process (zlib + a minimal tar reader) rather than by
 * shelling out, so this behaves the same on an Alpine build stage and on a
 * developer's Windows machine.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'

const EDITIONS = ['GeoLite2-ASN', 'GeoLite2-City']
const OUT_DIR = process.env.GEOIP_DIR?.trim() || path.join('data', 'geoip')
const LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY?.trim()
const ACCOUNT_ID = process.env.MAXMIND_ACCOUNT_ID?.trim()

/** MaxMind serves only .tar.gz — there is no bare .mmdb endpoint. */
function downloadUrl(edition) {
  const url = new URL('https://download.maxmind.com/app/geoip_download')
  url.searchParams.set('edition_id', edition)
  url.searchParams.set('suffix', 'tar.gz')
  // Basic auth is preferred when an account id is available; the license_key
  // query parameter is the older scheme and still works for GeoLite2.
  if (!ACCOUNT_ID) url.searchParams.set('license_key', LICENSE_KEY)
  return url
}

/**
 * Minimal ustar reader. Tar is a flat sequence of 512-byte header blocks, each
 * followed by its file body padded to the next 512-byte boundary; two zero
 * blocks terminate the archive. We only need the one `.mmdb` member, so nothing
 * here handles links, long names or sparse files — an unrecognised member is
 * skipped rather than treated as an error.
 */
export function extractMmdb(buffer) {
  const BLOCK = 512
  for (let offset = 0; offset + BLOCK <= buffer.length; ) {
    const header = buffer.subarray(offset, offset + BLOCK)
    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeField, 8)
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Corrupt tar header at byte ${offset} (size field "${sizeField}")`)
    }

    const body = offset + BLOCK
    if (name.endsWith('.mmdb')) return buffer.subarray(body, body + size)

    // Advance past the body, rounded up to the next block boundary.
    offset = body + Math.ceil(size / BLOCK) * BLOCK
  }
  return null
}

async function fetchEdition(edition) {
  const url = downloadUrl(edition)
  const headers = {}
  if (ACCOUNT_ID) {
    headers.authorization = `Basic ${Buffer.from(`${ACCOUNT_ID}:${LICENSE_KEY}`).toString('base64')}`
  }

  const response = await fetch(url, { headers, redirect: 'follow' })
  if (!response.ok) {
    // MaxMind answers 401 for a bad key and 404 for an edition the account is not
    // entitled to — both are worth spelling out, they look identical otherwise.
    throw new Error(
      `${edition}: ${response.status} ${response.statusText}` +
        (response.status === 401 ? ' — check MAXMIND_LICENSE_KEY' : ''),
    )
  }

  const archive = Buffer.from(await response.arrayBuffer())
  const mmdb = extractMmdb(gunzipSync(archive))
  if (!mmdb) throw new Error(`${edition}: archive contained no .mmdb member`)

  // Write to a temp name and rename into place. `maxmind` watches these files for
  // updates, so a half-written database must never be visible under its real name.
  const target = path.join(OUT_DIR, `${edition}.mmdb`)
  const temp = `${target}.partial`
  await new Promise((resolve, reject) => {
    const out = createWriteStream(temp)
    out.on('error', reject)
    out.on('finish', resolve)
    out.end(mmdb)
  })
  await rename(temp, target)

  const { size } = await stat(target)
  console.log(`  ${edition} → ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}

async function main() {
  // Created unconditionally so the Dockerfile can COPY the directory whether or
  // not a licence key was supplied — an absent path would fail the build.
  await mkdir(OUT_DIR, { recursive: true })

  if (!LICENSE_KEY) {
    console.log('MAXMIND_LICENSE_KEY not set — skipping GeoLite2 download.')
    console.log('The app runs without it: geo lookups return null and the resolver')
    console.log('falls back to the CloudFront viewer headers. See docs/GEOIP.md.')
    return
  }

  console.log(`Fetching GeoLite2 databases into ${OUT_DIR}/`)

  for (const edition of EDITIONS) {
    try {
      await fetchEdition(edition)
    } catch (error) {
      // One edition failing must not take the other down with it: the ASN
      // database alone is enough to run the carrier gate, which is the tier that
      // matters most.
      console.error(`  ${error instanceof Error ? error.message : error}`)
      await rm(path.join(OUT_DIR, `${edition}.mmdb.partial`), { force: true })
      process.exitCode = 1
    }
  }
}

// Only run when invoked as a script — `extractMmdb` is imported by its unit test,
// and importing this file must not start a download.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

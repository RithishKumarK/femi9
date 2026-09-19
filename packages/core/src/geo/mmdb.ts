import 'server-only'
import type { Reader, CityResponse, AsnResponse } from 'maxmind'

/**
 * MaxMind GeoLite2 lookups, read from a LOCAL FILE — never an API.
 *
 * Why a file and not a hosted endpoint: `resolveAmbientZone()` runs on the
 * catalog grid, the cart and the checkout summary, so a REST geo-IP provider
 * would put a third-party network hop on the critical path of every server
 * render, add 50–200ms, import someone else's uptime into ours, and ship every
 * visitor's IP to a third party (a DPDP-Act question we do not need to answer).
 * An `.mmdb` is memory-mapped and answers in microseconds with no egress at all,
 * which is also what the container is built for — see the Dockerfile note about
 * migrations running without network access.
 *
 * WHAT THESE DATABASES ARE ACTUALLY FOR
 *
 * GeoLite2-City's *location* accuracy for Indian mobile carriers is no better
 * than the CloudFront edge lookup we already had — the IPv4 address is a CGNAT
 * gateway and no data vendor can extract a subscriber's district from it. These
 * files are here for the two fields that tell us WHEN NOT TO TRUST A LOCATION:
 *
 *   GeoLite2-ASN   → which network the viewer is on, so a mobile carrier can be
 *                    recognised and its region answer discarded (see carriers.ts).
 *   GeoLite2-City  → `location.accuracy_radius`, a kilometre figure that is
 *                    honest about how coarse the answer is.
 *
 * The genuine accuracy win is on IPv6, which carriers do not NAT — see ip.ts.
 *
 * BOTH FILES ARE OPTIONAL. Absent (local dev, a fresh image, a failed refresh)
 * every lookup returns null and the caller falls back to the CloudFront headers,
 * i.e. exactly the behaviour that shipped before this module existed.
 *
 * Licensing: GeoLite2 is MaxMind's free tier — it needs a signed-up licence key
 * and carries attribution terms. See docs/GEOIP.md before shipping the files.
 */

/** Where the databases live. Overridable so ECS can mount them anywhere. */
const ASN_DB_PATH = process.env.GEOIP_ASN_DB?.trim() || 'data/geoip/GeoLite2-ASN.mmdb'
const CITY_DB_PATH = process.env.GEOIP_CITY_DB?.trim() || 'data/geoip/GeoLite2-City.mmdb'

/**
 * A reader, or null when the file is not there.
 *
 * Cached as the PROMISE, not the result, so concurrent first requests share one
 * open() instead of racing to map the same file several times. `null` is cached
 * too — a missing file must not cost a failed open on every single request.
 */
let asnReader: Promise<Reader<AsnResponse> | null> | null = null
let cityReader: Promise<Reader<CityResponse> | null> | null = null

async function openReader<T extends AsnResponse | CityResponse>(path: string): Promise<Reader<T> | null> {
  try {
    // Imported lazily so `maxmind` (and node:fs with it) is only pulled in when a
    // database is actually configured — this module is in the import graph of
    // every priced page.
    const { open } = await import('maxmind')
    return await open<T>(path, {
      // Bounded LRU over decoded records. Traffic concentrates on a small number
      // of carrier prefixes, so this hits far more often than the size suggests.
      cache: { max: 10_000 },
      // Re-read the file in place when the refresh cron replaces it, so a weekly
      // database update does not need a task restart. The non-persistent variant
      // unrefs the watcher, otherwise it would hold the event loop open and stop
      // the container from exiting cleanly.
      watchForUpdates: true,
      watchForUpdatesNonPersistent: true,
    })
  } catch {
    // Missing file, wrong permissions, truncated download. Geo is best-effort by
    // contract; a broken database must degrade, never throw into a page render.
    return null
  }
}

/**
 * Drop the cached readers so the next lookup re-opens from disk.
 * Called by the refresh cron after it writes new files — `watchForUpdates`
 * handles in-place replacement, but not the case where the file did not exist
 * when the process started and the null result got cached.
 */
export function resetGeoipReaders(): void {
  asnReader = null
  cityReader = null
}

/** True when at least one database is loadable — surfaced on the health route. */
export async function geoipStatus(): Promise<{ asn: boolean; city: boolean }> {
  const [asn, city] = await Promise.all([
    (asnReader ??= openReader<AsnResponse>(ASN_DB_PATH)),
    (cityReader ??= openReader<CityResponse>(CITY_DB_PATH)),
  ])
  return { asn: Boolean(asn), city: Boolean(city) }
}

export interface AsnLookup {
  number: number
  organization: string
}

/** The autonomous system an address belongs to, or null. */
export async function lookupAsn(address: string): Promise<AsnLookup | null> {
  const reader = await (asnReader ??= openReader<AsnResponse>(ASN_DB_PATH))
  if (!reader) return null
  try {
    const row = reader.get(address)
    if (!row?.autonomous_system_number) return null
    return {
      number: row.autonomous_system_number,
      organization: row.autonomous_system_organization || '',
    }
  } catch {
    return null
  }
}

export interface CityLookup {
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  country?: string
  /** ISO 3166-2 subdivision code, e.g. "TN" — feeds `toIndiaState`. */
  regionCode?: string
  /** The spelled subdivision name, preferred over the code when present. */
  regionName?: string
  city?: string
  postal?: string
  /**
   * MaxMind's own honesty about the answer: the radius in km within which the
   * true location is expected to fall. On Indian mobile IPv4 this is routinely
   * 500–1000, which is the database saying "somewhere in India" — the gate in
   * detect.ts turns that into "no region" instead of a confident wrong state.
   */
  accuracyRadiusKm?: number
}

/** City-level record for an address, or null when unavailable. */
export async function lookupCity(address: string): Promise<CityLookup | null> {
  const reader = await (cityReader ??= openReader<CityResponse>(CITY_DB_PATH))
  if (!reader) return null
  try {
    const row = reader.get(address)
    if (!row) return null
    // Only the FIRST subdivision is read: India's second level is district-like
    // and does not line up with the state names ZoneRegion rows are keyed on.
    const subdivision = row.subdivisions?.[0]
    return {
      country: row.country?.iso_code,
      regionCode: subdivision?.iso_code,
      regionName: subdivision?.names?.en,
      city: row.city?.names?.en,
      postal: row.postal?.code,
      accuracyRadiusKm: row.location?.accuracy_radius,
    }
  } catch {
    return null
  }
}

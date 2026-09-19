import 'server-only'
import type { Brand } from '@femi9/db'
import { headers } from 'next/headers'
import { INDIA_STATES } from './india-states'
import { parseIp, type ParsedIp } from './ip'
import { lookupAsn, lookupCity, type CityLookup } from './mmdb'
import { classifyCarrier, type CarrierMatch } from './carriers'
import { lookupCircle } from './circles'
import { languageHint, contradictsState, type LanguageHint } from './language'
import type { LocationSignal } from '../services/pricing'

/**
 * Where is this visitor? — resolved from several signals, each carrying how much
 * it can be trusted.
 *
 * This used to be a single source: CloudFront resolves the viewer's IP at the
 * edge and passes `CloudFront-Viewer-*` headers to the origin. That works over
 * WiFi and FAILS ON MOBILE DATA, because Jio/Airtel/Vi/BSNL CGNAT their IPv4 and
 * the address CloudFront sees belongs to a regional gateway rather than to the
 * shopper — a Coimbatore phone routinely resolves to Mumbai. The edge is not
 * wrong; the IP simply does not contain the answer.
 *
 * So the resolver now runs a LADDER and stops at the first tier that clears the
 * confidence bar:
 *
 *   1. dev override headers                     (local/staging only)
 *   2. IPv6 → telecom circle  (circles.ts)      carriers do not NAT IPv6, and its
 *                                               prefixes are allocated per circle
 *   3. IPv6 → GeoLite2 city   (mmdb.ts)         same reason, coarser
 *   4. CloudFront edge headers                  the previous behaviour…
 *   5. IPv4 → GeoLite2 city                     …and its offline equivalent
 *
 * …with two things that can REMOVE a signal rather than add one:
 *
 *   • the carrier gate (carriers.ts) discards tiers 4–5 outright when the viewer
 *     is on a mobile ASN, because those tiers are reading a CGNAT gateway;
 *   • `accuracy_radius` and the `Accept-Language` veto (language.ts) drop an
 *     answer the data itself says is coarse or self-contradictory.
 *
 * REFUSING TO ANSWER IS A FEATURE. An empty signal resolves to the default zone,
 * which is the STANDARD price. Under the old discount-only design a missing
 * signal could only cost a shopper a discount — but a zone can now set an EXACT
 * price that is not guaranteed to be below standard (services/pricing.ts), so a
 * *wrong* signal can overcharge her. Between a confident wrong state and no
 * state, no state is now strictly the safer answer.
 *
 * Everything degrades: no GeoLite2 files, no ASN, no CDN, no request scope — each
 * simply removes tiers, and with all of them gone this behaves exactly as it did
 * before. This remains a HINT for browsing; the authoritative signal for an order
 * is the delivery address typed at checkout, which `placeOrder` resolves itself.
 */

/** Lowercased header names — Next normalises incoming headers to lowercase. */
const H = {
  country: 'cloudfront-viewer-country',
  regionCode: 'cloudfront-viewer-country-region',
  regionName: 'cloudfront-viewer-country-region-name',
  postal: 'cloudfront-viewer-postal-code',
  city: 'cloudfront-viewer-city',
  address: 'cloudfront-viewer-address',
  asn: 'cloudfront-viewer-asn',
  forwardedFor: 'x-forwarded-for',
  realIp: 'x-real-ip',
  acceptLanguage: 'accept-language',
} as const

/** Dev-only override so regional pricing can be exercised without a CDN in front. */
const DEV_STATE_HEADER = 'x-femi9-geo-state'
const DEV_PINCODE_HEADER = 'x-femi9-geo-pincode'

/**
 * How coarse a GeoLite2 answer may be before its region is thrown away, in km.
 *
 * MaxMind publishes `location.accuracy_radius` as its own honesty about each
 * record. Indian mobile IPv4 routinely comes back at 500–1000km, which is the
 * database saying "somewhere in India"; a state read off that record is noise
 * wearing a state's name. 250km is roughly one large Indian state, so anything
 * wider cannot pin a state even in principle.
 */
const MAX_ACCURACY_RADIUS_KM = Number(process.env.GEOIP_MAX_ACCURACY_RADIUS_KM ?? 250)

/**
 * ISO 3166-2:IN subdivision code → the state name used by ZoneRegion rows and
 * the admin editor. CloudFront sends the CODE in `-Country-Region`; the spelled
 * name in `-Country-Region-Name` is preferred when present, and this map is the
 * fallback for the many edges that send only the code. GeoLite2's
 * `subdivisions[0].iso_code` uses the same vocabulary, so both feed this.
 *
 * The pre-2020 codes for the merged UT (DN, DD) and the alternate Odisha code
 * (OD) are included because geo databases disagree on which vintage they emit.
 */
const IN_REGION_CODES: Record<string, string> = {
  AN: 'Andaman and Nicobar Islands',
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CH: 'Chandigarh',
  CT: 'Chhattisgarh',
  CG: 'Chhattisgarh',
  DH: 'Dadra and Nagar Haveli and Daman and Diu',
  DN: 'Dadra and Nagar Haveli and Daman and Diu',
  DD: 'Dadra and Nagar Haveli and Daman and Diu',
  DL: 'Delhi',
  GA: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  HP: 'Himachal Pradesh',
  JH: 'Jharkhand',
  JK: 'Jammu and Kashmir',
  KA: 'Karnataka',
  KL: 'Kerala',
  LA: 'Ladakh',
  LD: 'Lakshadweep',
  MH: 'Maharashtra',
  ML: 'Meghalaya',
  MN: 'Manipur',
  MP: 'Madhya Pradesh',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OR: 'Odisha',
  OD: 'Odisha',
  PB: 'Punjab',
  PY: 'Puducherry',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TG: 'Telangana',
  TS: 'Telangana',
  TN: 'Tamil Nadu',
  TR: 'Tripura',
  UP: 'Uttar Pradesh',
  UT: 'Uttarakhand',
  UK: 'Uttarakhand',
  WB: 'West Bengal',
}

/** Case-insensitive lookup of a spelled region name against the canonical list. */
const STATE_BY_LOWER = new Map(INDIA_STATES.map((s) => [s.toLowerCase(), s as string]))

/**
 * Turn a region code/name pair into a canonical state name.
 * Exported for tests — this is the part that silently mis-maps if a geo
 * provider changes vintage, and it is not otherwise reachable without a CDN.
 */
export function toIndiaState(regionCode?: string | null, regionName?: string | null): string | undefined {
  const named = regionName?.trim().toLowerCase()
  if (named) {
    const exact = STATE_BY_LOWER.get(named)
    if (exact) return exact
  }
  const code = regionCode?.trim().toUpperCase()
  if (code && IN_REGION_CODES[code]) return IN_REGION_CODES[code]
  return undefined
}

/** Which tier produced the answer. */
export type GeoSource =
  | 'dev-header'
  | 'ipv6-circle'
  | 'ipv6-city'
  | 'edge-header'
  | 'ip-city'
  | 'none'

/**
 * How far the answer can be trusted. Only `high` and `medium` are allowed to
 * price — see `USABLE`.
 */
export type GeoConfidence = 'high' | 'medium' | 'low' | 'none'

/** Why a signal was discarded, for telemetry. Never shown to a shopper. */
export type GeoRejection =
  | 'no-request-scope'
  | 'outside-india'
  | 'mobile-carrier-cgnat'
  | 'accuracy-radius-too-wide'
  | 'language-contradiction'
  | 'no-signal'

export interface GeoReading {
  /** What the price resolver consumes. Empty when nothing cleared the bar. */
  signal: LocationSignal
  source: GeoSource
  confidence: GeoConfidence
  /**
   * Diagnostics. Logged and measured; NEVER an input to a price. This is what
   * makes the carrier gate auditable — without `asn`/`carrier` you cannot tell a
   * shopper who got the default zone because she is genuinely unplaceable from
   * one who got it because we threw a good signal away.
   */
  detail: {
    ipVersion?: 'v4' | 'v6'
    asn?: number
    asnOrg?: string
    carrier?: CarrierMatch['kind']
    carrierLabel?: string
    accuracyRadiusKm?: number
    circlePrefix?: string
    circle?: string
    language?: string
    rejected?: GeoRejection
  }
}

/** Confidence levels a price may be resolved from. */
const USABLE: ReadonlySet<GeoConfidence> = new Set<GeoConfidence>(['high', 'medium'])

const EMPTY: GeoReading = { signal: {}, source: 'none', confidence: 'none', detail: {} }

function reject(reason: GeoRejection, detail: GeoReading['detail'] = {}): GeoReading {
  return { signal: {}, source: 'none', confidence: 'none', detail: { ...detail, rejected: reason } }
}

/**
 * The visitor's location as far as the network can tell, with provenance.
 *
 * Returns an empty reading outside a request scope (cron, tests, build-time
 * prerender) instead of throwing, so every caller can treat geo as best-effort.
 */
export async function detectGeoReading(brand: Brand): Promise<GeoReading> {
  let h: Awaited<ReturnType<typeof headers>>
  try {
    h = await headers()
  } catch {
    return reject('no-request-scope')
  }

  // A local/staging escape hatch: without a CDN in front there is no geo at all,
  // so regional pricing would be untestable outside production. Never honoured
  // in production, where these headers would be attacker-controlled input to a
  // price.
  if (process.env.NODE_ENV !== 'production') {
    const devState = h.get(DEV_STATE_HEADER)?.trim()
    const devPincode = h.get(DEV_PINCODE_HEADER)?.trim()
    if (devState || devPincode) {
      return {
        signal: { state: devState || undefined, pincode: devPincode || undefined },
        source: 'dev-header',
        confidence: 'high',
        detail: {},
      }
    }
  }

  // Regional pricing is India-only. A viewer the edge places elsewhere gets the
  // default zone rather than a state match on a coincidentally equal name.
  const headerCountry = h.get(H.country)?.trim().toUpperCase()
  if (headerCountry && headerCountry !== 'IN') return reject('outside-india')

  const ip = viewerIp(h)
  const network = await identifyNetwork(ip, h)
  const detail: GeoReading['detail'] = {
    ipVersion: ip?.version,
    asn: network.asn,
    asnOrg: network.organization,
    carrier: network.carrier?.kind,
    carrierLabel: network.carrier?.label,
  }

  // The offline database can veto the country too, for the case where the CDN
  // header is absent (a direct ALB hit, or a distribution without the policy).
  const city = ip && !ip.isPrivate ? await lookupCity(ip.address) : null
  if (!headerCountry && city?.country && city.country !== 'IN') {
    return reject('outside-india', detail)
  }

  const hint = languageHint(h.get(H.acceptLanguage))
  if (hint) detail.language = hint.language

  const reading = await resolveTiers(brand, { h, ip, network, city, detail })
  return applyLanguageVeto(reading, hint)
}

/**
 * Back-compatible entry point: the signal alone, and only when it is trustworthy
 * enough to set a price. Callers that want provenance use `detectGeoReading`.
 */
export async function detectGeoSignal(brand: Brand): Promise<LocationSignal> {
  const reading = await detectGeoReading(brand)
  return USABLE.has(reading.confidence) ? reading.signal : {}
}

// ─────────────────────────────── internals ───────────────────────────────

interface Network {
  asn?: number
  organization?: string
  carrier: CarrierMatch | null
}

/**
 * The viewer's address, preferring CloudFront's own `-Viewer-Address` over the
 * `X-Forwarded-For` chain. `-Viewer-Address` is generated at the edge and cannot
 * be spoofed at all.
 *
 * The XFF fallback takes the LAST entry, not the first. CloudFront does not
 * replace a viewer-supplied X-Forwarded-For — it APPENDS the viewer's address to
 * it — so `1.2.3.4` sent by a client arrives as `1.2.3.4, <real ip>` and the
 * FIRST entry is whatever that client chose. Entries are appended left to right,
 * which makes the rightmost the one our nearest trusted proxy wrote. Here that
 * only decides which pricing zone a shopper is offered; `clientIp()` in
 * ../rate-limit.ts keys throttling on the same rule, where getting it wrong
 * makes every per-IP limit unlimited.
 */
function viewerIp(h: Headers): ParsedIp | null {
  const cloudfront = parseIp(h.get(H.address))
  if (cloudfront) return cloudfront

  const forwarded = h.get(H.forwardedFor)
  if (forwarded) {
    const entries = forwarded.split(',')
    const parsed = parseIp(entries[entries.length - 1])
    if (parsed) return parsed
  }
  return parseIp(h.get(H.realIp))
}

/**
 * Which network the viewer is on. GeoLite2-ASN is preferred because it carries
 * the organisation name the carrier heuristic keys on; the `CloudFront-Viewer-ASN`
 * header is the fallback when the database is not present (it gives a number
 * only, so only the ASN table can match).
 */
async function identifyNetwork(ip: ParsedIp | null, h: Headers): Promise<Network> {
  let asn: number | undefined
  let organization: string | undefined

  if (ip && !ip.isPrivate) {
    const looked = await lookupAsn(ip.address)
    if (looked) {
      asn = looked.number
      organization = looked.organization || undefined
    }
  }
  if (asn === undefined) {
    const header = Number(h.get(H.asn)?.trim())
    if (Number.isInteger(header) && header > 0) asn = header
  }

  return { asn, organization, carrier: classifyCarrier(asn, organization) }
}

interface TierInput {
  h: Headers
  ip: ParsedIp | null
  network: Network
  city: CityLookup | null
  detail: GeoReading['detail']
}

/** Walk the ladder, stopping at the first tier that produces a usable state. */
async function resolveTiers(brand: Brand, { h, ip, network, city, detail }: TierInput): Promise<GeoReading> {
  // ── Tiers 2–3: IPv6. Carriers do not NAT it, so this survives the gate that
  // rejects their IPv4 — this is the tier that actually fixes mobile data.
  if (ip?.version === 'v6' && !ip.isPrivate) {
    const circle = await lookupCircle(brand, ip.address)
    if (circle) {
      detail.circle = circle.circle
      detail.circlePrefix = circle.prefix
      if (circle.state) {
        return { signal: { state: circle.state }, source: 'ipv6-circle', confidence: 'high', detail }
      }
      // A circle that spans several states (Andhra Pradesh, Bihar, North-East…)
      // identifies a region but not a state — see circles.ts. Fall through
      // rather than pick one.
    }

    const fromV6 = cityToSignal(city, detail)
    if (fromV6) {
      return { signal: fromV6, source: 'ipv6-city', confidence: 'medium', detail }
    }
  }

  // ── The gate. Everything below reads an IPv4 address; on a mobile carrier that
  // address is a CGNAT gateway, so its answer is discarded rather than trusted.
  if (network.carrier) {
    return { signal: {}, source: 'none', confidence: 'low', detail: { ...detail, rejected: 'mobile-carrier-cgnat' } }
  }

  // ── Tier 4: the CloudFront edge headers. Unchanged from the original resolver,
  // and still the best source for fixed-line viewers.
  const state = toIndiaState(h.get(H.regionCode), h.get(H.regionName))
  // Edge geo postcodes are coarse but the resolver only uses the leading 3
  // digits (the postal circle), which is the granularity zones are drawn at.
  const pincode = h.get(H.postal)?.replace(/\D/g, '') || undefined
  if (state || pincode) {
    return { signal: { state, pincode }, source: 'edge-header', confidence: 'medium', detail }
  }

  // ── Tier 5: the offline database, for a direct-to-ALB hit with no CDN headers.
  const fromCity = cityToSignal(city, detail)
  if (fromCity) {
    return { signal: fromCity, source: 'ip-city', confidence: 'medium', detail }
  }

  return { ...EMPTY, detail: { ...detail, rejected: detail.rejected ?? 'no-signal' } }
}

/**
 * A GeoLite2 city record as a location signal, or null when the record is too
 * coarse to name a state. The radius check is what stops a country-level record
 * (radius 1000) from being read as whichever state its centroid happens to sit
 * in — which for India is a point near Nagpur, and would price the whole
 * unplaceable population as Maharashtra.
 */
function cityToSignal(city: CityLookup | null, detail: GeoReading['detail']): LocationSignal | null {
  if (!city) return null
  detail.accuracyRadiusKm = city.accuracyRadiusKm

  if (city.accuracyRadiusKm !== undefined && city.accuracyRadiusKm > MAX_ACCURACY_RADIUS_KM) {
    detail.rejected = 'accuracy-radius-too-wide'
    return null
  }

  const state = toIndiaState(city.regionCode, city.regionName)
  const pincode = city.postal?.replace(/\D/g, '') || undefined
  if (!state && !pincode) return null
  return { state, pincode }
}

/**
 * Drop an answer the browser's own language preference contradicts.
 *
 * Applied only to `medium` tiers: a `high` answer (a dev override, or a learned
 * circle prefix backed by a dozen confirmed deliveries) outranks a language
 * guess, and a Tamil-speaking family that moved to Pune should not have a
 * verified circle match overturned by their browser locale.
 */
function applyLanguageVeto(reading: GeoReading, hint: LanguageHint | null): GeoReading {
  if (reading.confidence !== 'medium') return reading
  if (!contradictsState(hint, reading.signal.state ?? undefined)) return reading
  return {
    signal: {},
    source: 'none',
    confidence: 'low',
    detail: { ...reading.detail, rejected: 'language-contradiction' },
  }
}

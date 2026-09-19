import 'server-only'

/**
 * Is this viewer on a mobile carrier? — the gate that stops us pricing on a lie.
 *
 * THE PROBLEM. Jio, Airtel, Vi and BSNL run carrier-grade NAT on IPv4. Hundreds
 * of thousands of subscribers egress through a handful of regional gateways, so
 * the address CloudFront resolves belongs to the GATEWAY, not the shopper. A
 * phone in Coimbatore routinely resolves to Mumbai or Delhi. CloudFront is not
 * wrong — it correctly located the IP it was given; the IP simply is not where
 * the shopper is. That is why regional pricing works over WiFi (broadband ISPs
 * allocate per city, and the registrations are accurate) and misfires on mobile
 * data, which is the symptom this module exists to stop.
 *
 * THE FIX IS NOT A BETTER DATABASE. No vendor can recover a district from a
 * CGNAT gateway address, because the information is not in it. What we can do is
 * RECOGNISE the situation and refuse to price on it: a viewer we cannot place
 * falls through to the default zone, which is the standard price. Knowing that
 * we do not know is strictly better than being confidently wrong — and since a
 * zone may now set an EXACT price that is not guaranteed to be below standard
 * (see services/pricing.ts), being confidently wrong can now overcharge a
 * shopper, not merely under-discount her.
 *
 * WHAT SURVIVES THE GATE. Being on a carrier does not blank the viewer outright:
 * `detect.ts` still trusts an IPv6 address from the same carrier, because IPv6 is
 * not NAT'd and its prefixes are allocated per telecom circle (see circles.ts).
 * The gate only rejects the IPv4 answer.
 */

export type CarrierKind = 'mobile' | 'mixed'

export interface CarrierMatch {
  kind: CarrierKind
  /** Which rule fired — recorded so the two can be told apart when measuring. */
  via: 'asn' | 'organization' | 'env'
  label: string
}

/**
 * Autonomous systems that carry Indian MOBILE subscriber traffic.
 *
 * VERIFY THESE against the shipped GeoLite2-ASN database before trusting the
 * list — carriers reassign and consolidate ASNs (Vodafone and Idea merged; Jio
 * has absorbed several), and a stale number here fails OPEN: the viewer is
 * treated as fixed-line and their wrong region is used. The organisation-name
 * rule below is the safety net for exactly that case, and is the primary
 * mechanism; this table is the fast path.
 */
const MOBILE_ASNS = new Map<number, string>([
  [55836, 'Reliance Jio Infocomm'],
  [45609, 'Bharti Airtel - mobile'],
  [55644, 'Idea Cellular'],
  [38266, 'Vodafone India'],
])

/**
 * Carriers that run BOTH fixed-line and mobile on one ASN.
 *
 * These are the awkward ones. Airtel's AS24560 fronts Xstream broadband — which
 * geolocates perfectly well — alongside mobile traffic, and nothing in a free
 * database distinguishes them. Treating the whole ASN as mobile throws away good
 * broadband signal; treating it as fixed keeps the bad mobile signal. We choose
 * to distrust, because the failure modes are not symmetric: a discarded good
 * signal costs a shopper a discount, while a kept bad signal can now charge her
 * the wrong price outright.
 *
 * Tag them separately so the telemetry can measure what that choice actually
 * costs, and split them later if the data says the trade is not worth it. (The
 * field that would settle it — `traits.user_type === 'cellular'` — exists only in
 * MaxMind's PAID GeoIP2 databases, not in GeoLite2.)
 */
const MIXED_ASNS = new Map<number, string>([
  [24560, 'Bharti Airtel - Telemedia + mobile'],
  [9498, 'Bharti Airtel - backbone'],
  [9829, 'BSNL National Internet Backbone'],
  [17813, 'MTNL Mumbai'],
  [18101, 'Reliance Communications'],
])

/**
 * Organisation-name fallback, applied when the ASN number is unlisted.
 *
 * The AS *organisation* string is far more stable than the number, so this
 * catches reassignments and ASNs we never enumerated. Matched against
 * GeoLite2-ASN's `autonomous_system_organization`.
 */
const MOBILE_ORG_PATTERN =
  /\b(jio|airtel|vodafone|idea\s*cellular|vi\s*india|bsnl|mtnl|aircel|telenor|reliance\s*communications)\b/i

/**
 * Escape hatch: `GEOIP_MOBILE_ASNS="55836,45609"` adds ASNs without a deploy.
 * Ops needs to be able to gate a newly-observed carrier prefix the same day it
 * starts mispricing, not at the next release.
 */
function envAsns(): Set<number> {
  const raw = process.env.GEOIP_MOBILE_ASNS?.trim()
  if (!raw) return new Set()
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const n = Number(part.trim())
    if (Number.isInteger(n) && n > 0) out.add(n)
  }
  return out
}

/**
 * Classify a network, or null when it looks like ordinary fixed-line access.
 *
 * `asn`/`organization` come from GeoLite2-ASN when the database is present, and
 * from the `CloudFront-Viewer-ASN` header otherwise. With neither, this returns
 * null and the caller keeps today's behaviour — the gate is an improvement when
 * it can run, never a prerequisite.
 */
export function classifyCarrier(asn?: number | null, organization?: string | null): CarrierMatch | null {
  if (asn && envAsns().has(asn)) {
    return { kind: 'mobile', via: 'env', label: `AS${asn} (GEOIP_MOBILE_ASNS)` }
  }
  if (asn) {
    const mobile = MOBILE_ASNS.get(asn)
    if (mobile) return { kind: 'mobile', via: 'asn', label: mobile }
    const mixed = MIXED_ASNS.get(asn)
    if (mixed) return { kind: 'mixed', via: 'asn', label: mixed }
  }

  const org = organization?.trim()
  if (org && MOBILE_ORG_PATTERN.test(org)) {
    // Unlisted ASN but a carrier name — assume mixed rather than mobile. We know
    // it is a telco; we do not know that this particular ASN is the mobile one.
    return { kind: 'mixed', via: 'organization', label: org }
  }

  return null
}

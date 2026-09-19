/**
 * Viewer IP parsing — the part every other geo source is keyed on.
 *
 * Deliberately dependency-free and side-effect-free so it is unit-testable
 * without a request, a CDN or a database. Nothing here decides a location; it
 * only answers "what address is this, and what prefix does it sit in".
 *
 * The IPv6 half matters more than it looks. Indian mobile carriers CGNAT their
 * IPv4 — hundreds of thousands of subscribers share a handful of regional
 * gateways, so the IPv4 address identifies the gateway and not the shopper. Their
 * IPv6 is generally NOT NAT'd: each subscriber gets a real delegated prefix, and
 * the aggregation blocks above it are allocated per TELECOM CIRCLE. That is the
 * one place the carrier network still carries the information CGNAT destroys,
 * which is why `v6PrefixKeys` exists.
 */

export type IpVersion = 'v4' | 'v6'

export interface ParsedIp {
  /** The address with any port, brackets or v4-mapped prefix removed. */
  address: string
  version: IpVersion
  /** Loopback, RFC1918, link-local, ULA, documentation ranges — never geo-locatable. */
  isPrivate: boolean
}

/**
 * Normalise whatever the proxy chain handed us into a bare address.
 *
 * Handles the four shapes that actually arrive in production:
 *   "1.2.3.4"                    — plain
 *   "1.2.3.4:51234"              — ALB/CloudFront-Viewer-Address include the port
 *   "[2405:201::1]:51234"        — the IPv6 spelling of the same
 *   "::ffff:1.2.3.4"             — v4-mapped v6, emitted by dual-stack listeners
 *
 * Returns null for anything unparseable, including the literal "unknown" that
 * `clientIp()` falls back to.
 */
export function parseIp(raw: string | null | undefined): ParsedIp | null {
  const trimmed = raw?.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null

  let value = trimmed

  // "[v6]:port" → "v6". Must run before the port strip below, which would
  // otherwise mangle every colon-bearing IPv6 address.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  if (bracketed) {
    value = bracketed[1]!
  } else if (value.includes('.') && value.includes(':')) {
    // Bare "v4:port" — a lone colon on a dotted address can only be a port.
    const [host] = value.split(':')
    if (host) value = host
  }

  // v4-mapped v6 ("::ffff:1.2.3.4") is an IPv4 address wearing a v6 costume.
  // Treating it as v6 would key it to a prefix that means nothing.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  if (mapped) value = mapped[1]!

  if (value.includes(':')) {
    const groups = v6Groups(value)
    if (!groups) return null
    return { address: value.toLowerCase(), version: 'v6', isPrivate: isPrivateV6(groups) }
  }

  const octets = v4Octets(value)
  if (!octets) return null
  return { address: value, version: 'v4', isPrivate: isPrivateV4(octets) }
}

/** The four octets of a dotted-quad, or null if it is not one. */
export function v4Octets(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out.push(n)
  }
  return out
}

/**
 * Expand an IPv6 address to its eight 16-bit groups, resolving "::".
 * Returns null on anything malformed — a half-parsed address must never be
 * allowed to produce a confident-looking prefix.
 */
export function v6Groups(value: string): number[] | null {
  const lower = value.toLowerCase()
  // The embedded-IPv4 form ("::ffff:1.2.3.4") is unwrapped by parseIp; anything
  // still carrying a dot here is not an address shape we key prefixes on.
  if (lower.includes('.')) return null

  const halves = lower.split('::')
  if (halves.length > 2) return null

  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []

  let groups: string[]
  if (halves.length === 1) {
    if (head.length !== 8) return null
    groups = head
  } else {
    // "::" must stand in for at least one group, so head+tail can be at most 7.
    if (head.length + tail.length > 7) return null
    groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
  }

  const out: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    out.push(parseInt(group, 16))
  }
  return out.length === 8 ? out : null
}

/** Loopback, RFC1918, CGNAT's own 100.64/10, link-local. */
function isPrivateV4(o: number[]): boolean {
  const [a, b] = o as [number, number, number, number]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  // 100.64.0.0/10 is the shared address space carriers CGNAT *behind*. Seeing it
  // as a viewer address means a proxy leaked an internal hop, not a real client.
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/** Unspecified, loopback, unique-local (fc00::/7) and link-local (fe80::/10). */
function isPrivateV6(groups: number[]): boolean {
  const first = groups[0]!
  if (groups.every((g) => g === 0)) return true
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  return false
}

/** The 32 hex nibbles of an expanded IPv6 address. */
function v6Nibbles(groups: number[]): string {
  return groups.map((g) => g.toString(16).padStart(4, '0')).join('')
}

/**
 * Prefix lengths we key the circle table on, LONGEST FIRST.
 *
 * All are multiples of 4 so a prefix is a whole number of hex nibbles and the
 * key is an exact string slice — no bitmask arithmetic, and no chance of two
 * different prefixes colliding on one key. /32 is roughly the size of a carrier's
 * RIR allocation and /48 a subscriber site; the circle boundary sits somewhere
 * between, and varies by carrier, so we probe the whole range and take the most
 * specific row that exists.
 */
export const V6_PREFIX_BITS = [48, 44, 40, 36, 32] as const

/**
 * Candidate lookup keys for an IPv6 address, most specific first, in the form
 * `"2405201100/36"` (nibbles + length). Callers query all of them at once and
 * keep the first hit, which is a longest-prefix match without needing Postgres
 * `inet` types Prisma cannot express.
 */
export function v6PrefixKeys(groups: number[]): string[] {
  const nibbles = v6Nibbles(groups)
  return V6_PREFIX_BITS.map((bits) => `${nibbles.slice(0, bits / 4)}/${bits}`)
}

/** The /24 an IPv4 address sits in, as a stable key for observation tables. */
export function v4PrefixKey(octets: number[]): string {
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

/**
 * The prefix key a parsed address should be recorded under, whatever its family.
 * IPv6 is keyed at /48 — the subscriber site — because that is the finest
 * granularity that is still stable for one household.
 */
export function prefixKeyFor(ip: ParsedIp): string | null {
  if (ip.version === 'v6') {
    const groups = v6Groups(ip.address)
    return groups ? v6PrefixKeys(groups)[0]! : null
  }
  const octets = v4Octets(ip.address)
  return octets ? v4PrefixKey(octets) : null
}

/**
 * IP parsing and prefix keys for per-network rate limiting. Pure, kept real.
 */

export const V6_PREFIX_BITS = 64

export type ParsedIp = { kind: 'v4'; value: string } | { kind: 'v6'; value: string } | null

export function parseIp(input: string | null | undefined): ParsedIp {
  if (!input) return null
  const ip = input.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').every((o) => Number(o) <= 255) ? { kind: 'v4', value: ip } : null
  }
  if (ip.includes(':')) return { kind: 'v6', value: ip.toLowerCase() }
  return null
}

/** The /24, which is the coarsest useful unit for abuse from one household. */
export function v4PrefixKey(ip: string): string {
  return ip.split('.').slice(0, 3).join('.') + '.0/24'
}

/** Expand :: and return the eight 16-bit groups. */
export function v6Groups(ip: string): string[] {
  const [head, tail] = ip.split('::')
  const left = head ? head.split(':').filter(Boolean) : []
  const right = tail ? tail.split(':').filter(Boolean) : []
  const fill = Array(Math.max(0, 8 - left.length - right.length)).fill('0')
  return [...left, ...fill, ...right].slice(0, 8).map((g) => g.padStart(4, '0'))
}

export function v6PrefixKeys(ip: string, bits: number = V6_PREFIX_BITS): string[] {
  const groups = v6Groups(ip)
  const keep = Math.ceil(bits / 16)
  return [groups.slice(0, keep).join(':') + `::/${bits}`]
}

export function prefixKeyFor(input: string | null | undefined): string | null {
  const parsed = parseIp(input)
  if (!parsed) return null
  return parsed.kind === 'v4' ? v4PrefixKey(parsed.value) : v6PrefixKeys(parsed.value)[0]
}

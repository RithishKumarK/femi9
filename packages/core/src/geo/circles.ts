import 'server-only'
import { dbFor, type Brand } from '@femi9/db'
import { v6Groups, v6PrefixKeys } from './ip'
import type { IndiaState } from './india-states'

/**
 * IPv6 prefix → Indian telecom circle → state.
 *
 * THE IDEA. Carriers CGNAT their IPv4, which destroys location (see carriers.ts).
 * They do not NAT IPv6: every subscriber gets a real delegated prefix, and the
 * blocks above it are allocated per LICENSED SERVICE AREA — the 22 "telecom
 * circles" the DoT carved India into. Those circles are drawn on state lines.
 * So for a viewer arriving over IPv6, the address still carries roughly the
 * granularity a pricing zone needs, exactly where the IPv4 address carries none.
 *
 * WHY THE TABLE IS EMPTY. The circle boundaries below are public fact and are
 * hard-coded. The mapping from an IPv6 prefix to a circle is NOT public — no
 * registry publishes it, carriers do not document it, and it changes. Inventing
 * plausible-looking prefixes here would silently misprice real shoppers, which is
 * worse than the bug we are fixing. So `IpCircleRange` ships EMPTY and is
 * populated from OBSERVATION: every order pairs a viewer IP with a delivery
 * pincode the shopper typed, which is ground truth. That is the same technique
 * the commercial vendors sell, built from our own conversion data.
 *
 * Until it has rows this tier simply never fires, and `detect.ts` falls through
 * to the plain IPv6 city lookup — which is itself better than the IPv4 answer,
 * for the same not-NAT'd reason. See docs/GEOIP.md for the seeding procedure.
 */

/**
 * The 22 licensed service areas, and the states each covers.
 *
 * Several circles span more than one state, and the splits are historical: the
 * Andhra Pradesh circle predates the 2014 Telangana split and still serves both;
 * Maharashtra circle includes Goa but excludes Mumbai, which is its own metro
 * circle. A circle therefore identifies a STATE only when it covers exactly one
 * — `circleState` enforces that rather than guessing at the larger half, because
 * a guess here is a wrong price.
 */
export const TELECOM_CIRCLES: Record<string, readonly IndiaState[]> = {
  // Metro circles
  delhi: ['Delhi'],
  mumbai: ['Maharashtra'],
  kolkata: ['West Bengal'],

  // Category A
  'andhra-pradesh': ['Andhra Pradesh', 'Telangana'],
  gujarat: ['Gujarat', 'Dadra and Nagar Haveli and Daman and Diu'],
  karnataka: ['Karnataka'],
  maharashtra: ['Maharashtra', 'Goa'],
  'tamil-nadu': ['Tamil Nadu', 'Puducherry'],

  // Category B
  haryana: ['Haryana'],
  kerala: ['Kerala', 'Lakshadweep'],
  'madhya-pradesh': ['Madhya Pradesh', 'Chhattisgarh'],
  punjab: ['Punjab', 'Chandigarh'],
  rajasthan: ['Rajasthan'],
  'up-east': ['Uttar Pradesh'],
  'up-west': ['Uttar Pradesh', 'Uttarakhand'],
  'west-bengal': ['West Bengal', 'Sikkim', 'Andaman and Nicobar Islands'],

  // Category C
  assam: ['Assam'],
  bihar: ['Bihar', 'Jharkhand'],
  'himachal-pradesh': ['Himachal Pradesh'],
  'jammu-kashmir': ['Jammu and Kashmir', 'Ladakh'],
  'north-east': ['Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura'],
  odisha: ['Odisha'],
}

export type TelecomCircle = keyof typeof TELECOM_CIRCLES

/** Every circle name, for validating rows before they are written. */
export function isTelecomCircle(value: string): value is TelecomCircle {
  return Object.prototype.hasOwnProperty.call(TELECOM_CIRCLES, value)
}

/**
 * The state a circle identifies, or undefined when it spans several.
 *
 * Note what this deliberately gives up: the Tamil Nadu circle resolves cleanly,
 * but Andhra Pradesh, Maharashtra, Bihar, Madhya Pradesh, UP-West, West Bengal
 * and North-East do not, so a viewer in those circles gets no state from this
 * tier. Half the map being unusable is the honest outcome — the alternative is
 * pricing a Telangana shopper as if she were in Andhra Pradesh.
 */
export function circleState(circle: string): IndiaState | undefined {
  const states = TELECOM_CIRCLES[circle]
  return states?.length === 1 ? states[0] : undefined
}

export interface CircleMatch {
  circle: string
  state?: IndiaState
  /** The prefix row that matched, e.g. "2405201/32" — recorded for telemetry. */
  prefix: string
  /** How many observations back this row. Low counts are not yet trustworthy. */
  observations: number
}

/**
 * Minimum confirmed observations before a learned prefix is allowed to price.
 * One order from a prefix proves nothing; a prefix that has shipped to the same
 * circle a dozen times is a real signal. Tunable while the table is filling.
 */
const MIN_OBSERVATIONS = Number(process.env.GEOIP_CIRCLE_MIN_OBSERVATIONS ?? 12)

/**
 * Longest-prefix match for an IPv6 address against the learned circle table.
 *
 * All candidate prefix lengths are queried in ONE round trip and the most
 * specific hit wins — Prisma cannot express Postgres `inet` containment
 * operators, and a fixed set of nibble-aligned keys gets the same answer without
 * dropping to raw SQL. Returns null for IPv4, malformed input, an empty table,
 * or a row that has not yet cleared `MIN_OBSERVATIONS`.
 */
export async function lookupCircle(brand: Brand, address: string): Promise<CircleMatch | null> {
  const prisma = dbFor(brand)
  const groups = v6Groups(address)
  if (!groups) return null

  const keys = v6PrefixKeys(groups)
  try {
    const rows = await prisma.ipCircleRange.findMany({
      where: { prefix: { in: keys }, active: true },
      select: { prefix: true, circle: true, observations: true },
    })
    if (rows.length === 0) return null

    // `keys` is ordered longest-first, so the first key with a row is the
    // longest-prefix match.
    const byPrefix = new Map(rows.map((r) => [r.prefix, r]))
    for (const key of keys) {
      const row = byPrefix.get(key)
      if (!row) continue
      if (row.observations < MIN_OBSERVATIONS) return null
      return {
        circle: row.circle,
        state: circleState(row.circle),
        prefix: row.prefix,
        observations: row.observations,
      }
    }
    return null
  } catch {
    // The table may not exist yet on an un-migrated environment. Geo is
    // best-effort: a missing table means "no circle", never a failed render.
    return null
  }
}

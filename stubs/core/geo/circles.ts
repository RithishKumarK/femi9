/**
 * Telecom circles — the mobile-network regions an Indian MSISDN maps to.
 *
 * The real module uses the circle as a weak location signal when no better one
 * exists. The mapping below is the circle list itself plus each circle's
 * dominant state, which is the only part the callers read.
 */

/** Circle -> the state it mostly covers. Metro circles name their own city's state. */
const CIRCLE_STATE: Record<string, string> = {
  'Andhra Pradesh': 'Andhra Pradesh',
  Assam: 'Assam',
  Bihar: 'Bihar',
  Chennai: 'Tamil Nadu',
  Delhi: 'Delhi',
  Gujarat: 'Gujarat',
  Haryana: 'Haryana',
  'Himachal Pradesh': 'Himachal Pradesh',
  'Jammu and Kashmir': 'Jammu and Kashmir',
  Karnataka: 'Karnataka',
  Kerala: 'Kerala',
  Kolkata: 'West Bengal',
  'Madhya Pradesh': 'Madhya Pradesh',
  Maharashtra: 'Maharashtra',
  Mumbai: 'Maharashtra',
  'North East': 'Assam',
  Odisha: 'Odisha',
  Punjab: 'Punjab',
  Rajasthan: 'Rajasthan',
  'Tamil Nadu': 'Tamil Nadu',
  'Uttar Pradesh (East)': 'Uttar Pradesh',
  'Uttar Pradesh (West)': 'Uttar Pradesh',
  'West Bengal': 'West Bengal',
}

export const TELECOM_CIRCLES: string[] = Object.keys(CIRCLE_STATE)

export function isTelecomCircle(value: unknown): value is string {
  return typeof value === 'string' && value in CIRCLE_STATE
}

export function circleState(circle: string): string | null {
  return CIRCLE_STATE[circle] ?? null
}

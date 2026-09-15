/**
 * The Thara feature flag. Kept real: every Thara route 404s unless it is exactly "true".
 */

export function isTharaEnabled(): boolean {
  return process.env.THARA_ENABLED === 'true'
}

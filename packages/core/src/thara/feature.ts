/**
 * Feature flag for the whole Thara Model program (sub-projects A–F).
 * Read at call time so a re-deploy with a flipped env is picked up without
 * a code change. Strict equality against 'true' — anything else is off.
 */
export function isTharaEnabled(): boolean {
  return process.env.THARA_ENABLED === 'true'
}

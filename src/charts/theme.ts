/**
 * Chart palette — validated with the dataviz validator on a light (#fff) surface.
 * All six categorical hues pass: lightness band, chroma floor, adjacent CVD
 * separation (worst 28.7, floor 12), and >= 3:1 contrast. Assigned in fixed
 * order, never cycled. Text always wears INK tokens, never a series color.
 */
export const CATEGORICAL = ['#3E71C6', '#A86E0A', '#1E824F', '#834BAA', '#C24A34', '#0E9E94'] as const

/** Brand-forward aliases for single / double-series charts. */
export const C = {
  blue: '#3E71C6',
  gold: '#A86E0A',
  forest: '#1E824F',
  plum: '#834BAA',
  clay: '#C24A34',
  teal: '#0E9E94',
}

/** Sequential green ramp, light -> dark (monotonic lightness) for heat/intensity. */
export const SEQ_GREEN = ['#EAF3EE', '#CDE6D8', '#9FD1B9', '#63B592', '#2E9268', '#1E824F', '#0E5E39']

/** Reserved status colors — used with an icon + label, never as "series 7". */
export const STATUS = { good: '#1E824F', warning: '#A86E0A', serious: '#C24A34', critical: '#90010F' }

/** Cycle-phase colors (semantic states, each shipped with a label in the UI). */
export const PHASE = {
  period: '#C85C79', // menstrual
  predicted: '#E4A9B8', // predicted period (softer)
  fertile: '#7FD0C8', // fertile window
  ovulation: '#0E9E94', // peak fertility
  pms: '#E7B85C', // luteal / PMS
}

/** Text + structure tokens. Ink carries all labels; grid/axis stay recessive. */
export const INK = {
  primary: '#0B2A5B',
  secondary: '#41506a',
  muted: '#8592a8',
  grid: 'rgba(11,42,91,.08)',
  axis: 'rgba(11,42,91,.28)',
}

export const SURFACE = '#ffffff'

/**
 * `Accept-Language` as a CONTRADICTION DETECTOR — never as a location.
 *
 * A browser set to Tamil is weak evidence of being in Tamil Nadu and strong
 * evidence of NOT being in, say, Gujarat. So this is used in one direction only:
 * to VETO a low-grade IP guess that disagrees with it, never to assert a state
 * of its own. A veto drops the viewer to the default zone (the standard price),
 * so the worst case is a missed discount rather than a wrong charge.
 *
 * The limits are real and worth stating. Most Indian shoppers browse in `en-IN`,
 * so this fires for a minority. Tamil speakers live in Mumbai. And `hi` is
 * deliberately absent from the table below — Hindi spans a dozen states, so it
 * discriminates nothing and would veto correct answers across the whole north.
 * Precision over recall: only languages with a tight regional home are listed.
 */

import type { IndiaState } from './india-states'

/**
 * ISO 639-1 subtag → the states where that language is an official/dominant
 * regional language. A viewer whose browser prefers one of these is unlikely,
 * though not certain, to be outside the listed set.
 */
const LANGUAGE_HOMES: Record<string, readonly IndiaState[]> = {
  ta: ['Tamil Nadu', 'Puducherry'],
  ml: ['Kerala', 'Lakshadweep'],
  kn: ['Karnataka'],
  te: ['Andhra Pradesh', 'Telangana'],
  bn: ['West Bengal', 'Tripura', 'Andaman and Nicobar Islands'],
  mr: ['Maharashtra', 'Goa'],
  gu: ['Gujarat', 'Dadra and Nagar Haveli and Daman and Diu'],
  pa: ['Punjab', 'Chandigarh', 'Delhi', 'Haryana'],
  or: ['Odisha'],
  as: ['Assam'],
  kok: ['Goa', 'Maharashtra'],
  ks: ['Jammu and Kashmir'],
  // Intentionally NOT listed: hi, ur, en, sa — spoken across too many states to
  // contradict anything. Adding `hi` here would veto every correct answer in the
  // Hindi belt.
}

export interface LanguageHint {
  /** The subtag that matched, e.g. "ta". */
  language: string
  /** States consistent with that preference. */
  states: readonly IndiaState[]
}

/**
 * The strongest regional-language hint in an `Accept-Language` header, or null.
 *
 * Quality values are honoured, so `en-IN,ta;q=0.9` still yields Tamil — an
 * English-first browser with Tamil second is a normal Indian configuration, and
 * ignoring the lower-weighted entries would throw away almost all of the signal.
 */
export function languageHint(header: string | null | undefined): LanguageHint | null {
  const raw = header?.trim()
  if (!raw) return null

  const ranked: { subtag: string; q: number }[] = []
  for (const part of raw.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    const subtag = tag?.trim().toLowerCase().split('-')[0]
    if (!subtag || !Object.prototype.hasOwnProperty.call(LANGUAGE_HOMES, subtag)) continue

    let q = 1
    for (const param of params) {
      const match = /^\s*q=([\d.]+)\s*$/i.exec(param)
      if (match) q = Number(match[1]) || 0
    }
    if (q > 0) ranked.push({ subtag, q })
  }
  if (ranked.length === 0) return null

  ranked.sort((a, b) => b.q - a.q)
  const best = ranked[0]!
  return { language: best.subtag, states: LANGUAGE_HOMES[best.subtag]! }
}

/**
 * Does a regional-language preference contradict a detected state?
 *
 * True only when there IS a hint AND the state is outside its home set — an
 * absent header, an English-only browser or an unlisted language all return
 * false, so the veto never fires on missing evidence.
 */
export function contradictsState(hint: LanguageHint | null, state: string | undefined): boolean {
  if (!hint || !state) return false
  return !hint.states.some((s) => s.toLowerCase() === state.toLowerCase())
}

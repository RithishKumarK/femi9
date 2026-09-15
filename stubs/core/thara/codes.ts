/**
 * Referral code alphabet and normalisation. Pure, kept real.
 */

/** No I, O, 0 or 1: the four characters people mistype when reading a code aloud. */
export const LETTER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
export const DIGIT_ALPHABET = '23456789'

export function generateReferralCode(length = 6): string {
  const pool = LETTER_ALPHABET + DIGIT_ALPHABET
  let out = ''
  for (let i = 0; i < length; i++) out += pool[Math.floor(Math.random() * pool.length)]
  return out
}

export function normalizeReferralCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

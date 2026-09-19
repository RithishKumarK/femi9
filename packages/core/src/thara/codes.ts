import { randomInt } from 'node:crypto'

/**
 * Referral-code alphabets. Ambiguous characters excluded on both sides so a
 * customer typing a code they saw in WhatsApp doesn't have to guess between
 * O/0 or I/1/L. Shape: 4 letters then 4 digits, no separators.
 */
export const LETTER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ' // 23 chars — no I, L, O
export const DIGIT_ALPHABET = '23456789' // 8 chars — no 0, 1

const CODE_REGEX = new RegExp(`^[${LETTER_ALPHABET}]{4}[${DIGIT_ALPHABET}]{4}$`)

/** Emit one fresh code. Callers wrap in a unique-constraint retry loop. */
export function generateReferralCode(): string {
  let out = ''
  for (let i = 0; i < 4; i++) out += LETTER_ALPHABET[randomInt(LETTER_ALPHABET.length)]
  for (let i = 0; i < 4; i++) out += DIGIT_ALPHABET[randomInt(DIGIT_ALPHABET.length)]
  return out
}

/** Upper-case, strip whitespace, verify shape. Returns null if invalid. */
export function normalizeReferralCode(input: string): string | null {
  const upper = input.trim().toUpperCase().replace(/\s+/g, '')
  return CODE_REGEX.test(upper) ? upper : null
}

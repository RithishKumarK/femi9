import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function key(): Buffer {
  const raw = process.env.CYCLE_DATA_ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('CYCLE_DATA_ENCRYPTION_KEY is not set')
  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length !== 32) {
    throw new Error('CYCLE_DATA_ENCRYPTION_KEY must be exactly 32 base64-encoded bytes')
  }
  return decoded
}

/** True when the key is present and the right length — lets a read path degrade
 *  to "we couldn't open your history" instead of throwing a 500 at the route. */
export function cycleCryptoConfigured(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

/**
 * AES-256-GCM provides confidentiality and integrity. Every row gets a fresh
 * 96-bit IV; the auth tag rejects ciphertext modification before JSON parsing.
 */
export function encryptCyclePayload(payload: Record<string, unknown>): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(VERSION))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptCyclePayload(value: string): Record<string, unknown> {
  const [version, ivPart, tagPart, ciphertextPart] = value.split('.')
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Unsupported encrypted cycle payload')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64url'))
  decipher.setAAD(Buffer.from(VERSION))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ])
  const parsed = JSON.parse(plaintext.toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid encrypted cycle payload')
  }
  return parsed as Record<string, unknown>
}

/**
 * Non-throwing decrypt. Returns null for a row this process cannot open — a
 * rotated key, a truncated column, a payload from a future version.
 *
 * A single unreadable row used to throw out of getCycleData and 500 the whole
 * /dashboard route, which meant one bad write bricked the page permanently. The
 * read path now skips and COUNTS these instead, and the UI says so plainly.
 */
export function tryDecryptCyclePayload(value: string): Record<string, unknown> | null {
  try {
    return decryptCyclePayload(value)
  } catch {
    return null
  }
}

/**
 * Stable per-user day fingerprint, used as the uniqueness key that stops the
 * same period start being logged twice.
 *
 * It is an HMAC and never the plaintext date: the entire point of encrypting
 * `PeriodLog.encryptedData` is that a database leak must not reveal menstrual
 * dates, and a plaintext `startDay` column alongside it would hand them straight
 * back. Keyed off the same secret, so a leaked DB cannot be brute-forced across
 * the small date space without it. Deterministic, so the upsert can match.
 */
export function periodDayHash(userId: string, startDate: string): string {
  return createHmac('sha256', key()).update(`${userId}|${startDate}`).digest('base64url')
}

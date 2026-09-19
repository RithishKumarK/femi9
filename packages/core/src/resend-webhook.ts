import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_SKEW_SECONDS = 5 * 60

/** Verify Resend/Svix's v1 signature over `${id}.${timestamp}.${rawBody}`. */
export function verifyResendWebhook(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false
  const timestamp = Number(headers.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > MAX_SKEW_SECONDS) {
    return false
  }

  try {
    const encodedSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret
    const key = Buffer.from(encodedSecret, 'base64')
    const expected = createHmac('sha256', key)
      .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
      .digest()

    return headers.signature.split(/\s+/).some((candidate) => {
      const [version, value] = candidate.split(',')
      if (version !== 'v1' || !value) return false
      const actual = Buffer.from(value, 'base64')
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    })
  } catch {
    return false
  }
}

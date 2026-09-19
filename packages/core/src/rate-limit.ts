import 'server-only'
import { createHash } from 'node:crypto'
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { logger } from './logger'
import { parseIp } from './geo/ip'

/**
 * Fixed-window rate limiter with a shared DynamoDB store on ECS, optional
 * Upstash Redis support, and an in-process fallback for tests/development.
 * Both shared implementations increment atomically, so concurrent Fargate tasks
 * consume the same counter without races.
 *
 * Keys should be specific and abuse-scoped, e.g. `otp:req:<ip>`, `otp:req:<phone>`,
 * `login:<ip>`. Combine several checks (IP + subject) at a call site when needed.
 */

interface Bucket {
  count: number
  resetAt: number
}

const store = new Map<string, Bucket>()

// Opportunistic cleanup so the Map can't grow unbounded from one-off keys.
let lastSweep = 0
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k)
}

export interface RateResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

const REDIS_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`

function sharedKey(key: string): string {
  // Do not persist raw IP addresses, phone numbers, or emails in a shared store.
  return createHash('sha256').update(key).digest('base64url')
}

let dynamo: DynamoDBClient | undefined

async function dynamoRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<RateResult | null> {
  const tableName = process.env.RATE_LIMIT_TABLE
  if (!tableName) return null

  const window = Math.floor(now / windowMs)
  const resetAt = (window + 1) * windowMs
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)

  try {
    dynamo ??= new DynamoDBClient({})
    const response = await dynamo.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: { id: { S: `${sharedKey(key)}:${window}` } },
        UpdateExpression: 'ADD #count :one SET #expiresAt = if_not_exists(#expiresAt, :expiresAt)',
        ExpressionAttributeNames: {
          '#count': 'requestCount',
          '#expiresAt': 'expiresAt',
        },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          // DynamoDB TTL is epoch seconds. Keep expired windows briefly so a
          // delayed cleanup can never make an active bucket disappear early.
          ':expiresAt': { N: String(Math.ceil(resetAt / 1000) + 300) },
        },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: controller.signal },
    )
    const count = Number(response.Attributes?.requestCount?.N)
    if (!Number.isFinite(count)) throw new Error('invalid counter')
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: count <= limit ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
    }
  } catch (err) {
    logger.warn('rate_limit_dynamodb_fallback', {
      error: err instanceof Error ? err.name : 'unknown',
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function redisRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '')
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(['EVAL', REDIS_SCRIPT, '1', `femi9:rl:${sharedKey(key)}`, String(windowMs)]),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { result?: unknown; error?: unknown }
    if (body.error) throw new Error(String(body.error))
    if (!Array.isArray(body.result) || body.result.length < 2) {
      throw new Error('invalid response')
    }
    const count = Number(body.result[0])
    const ttl = Number(body.result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error('invalid counter')
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: count <= limit ? 0 : Math.max(1, Math.ceil(ttl / 1000)),
    }
  } catch (err) {
    // Keep the application available during a short Redis outage, but retain a
    // per-task guard and emit a structured signal for alerting.
    logger.warn('rate_limit_redis_fallback', {
      error: err instanceof Error ? err.name : 'unknown',
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Consume one unit against `key`. Allows up to `limit` hits per `windowMs`.
 * Returns ok:false with retryAfterSec once the window is exhausted.
 *
 * NOTE: pass a monotonic `now` in ms. Callers use Date.now(); this module is
 * only ever run inside a request (node runtime), never at import time.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateResult> {
  const dynamoResult = await dynamoRateLimit(key, limit, windowMs, now)
  if (dynamoResult) return dynamoResult

  const shared = await redisRateLimit(key, limit, windowMs)
  if (shared) return shared

  sweep(now)
  const b = store.get(key)
  if (!b || b.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 }
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) }
  }
  b.count += 1
  return { ok: true, remaining: limit - b.count, retryAfterSec: 0 }
}

/**
 * The address to key a rate-limit bucket on.
 *
 * ── Why this is not `x-forwarded-for.split(',')[0]` ────────────────────────
 * That is the shape every example uses, and behind CloudFront it is attacker
 * controlled. CloudFront does not REPLACE an X-Forwarded-For the viewer sent —
 * it APPENDS the viewer's address to it. So a client that sends
 * `X-Forwarded-For: 1.2.3.4` arrives at the origin as `1.2.3.4, <real ip>`, and
 * taking the first entry keys the bucket on a value the caller chose. Rotate it
 * per request and every per-IP limit on the platform — OTP requests, magic-link
 * requests, admin sign-in, checkout — becomes unlimited, while the code reads
 * as though it is throttling.
 *
 * `CloudFront-Viewer-Address` is generated at the edge, cannot be set by the
 * viewer, and is already forwarded to the origin (see the origin request policy
 * in infra/terraform/cloudfront.tf). It is therefore what we key on, and
 * `geo/detect.ts` has preferred it for the same reason since it was written.
 *
 * The XFF fallback takes the LAST entry rather than the first: entries are
 * appended left to right, so the rightmost is the one our nearest trusted proxy
 * wrote and the leftmost is whatever the client made up. That is still weaker
 * than the edge header — a request that reaches the ALB directly has only the
 * ALB's own single-entry XFF — which is why it is the fallback and not the
 * source. `parseIp` normalises the port CloudFront and the ALB include, so a
 * client cannot spread one address across many buckets by varying it.
 */
export function clientIp(req: Request): string {
  const viewer = parseIp(req.headers.get('cloudfront-viewer-address'))
  if (viewer) return viewer.address

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const entries = xff.split(',')
    const nearest = parseIp(entries[entries.length - 1])
    if (nearest) return nearest.address
  }

  const real = parseIp(req.headers.get('x-real-ip'))
  return real?.address ?? 'unknown'
}

/** 429 JSON response with a Retry-After header — use when rateLimit().ok is false.
 *  `retryAfterSec` is echoed in the BODY as well as the header because a fetch()
 *  in a form can read the body it already awaits, but reading a response header
 *  needs the caller to know it is there — and the auth screens render a live
 *  countdown from it. */
export function tooManyRequests(retryAfterSec: number) {
  const seconds = Math.max(1, retryAfterSec)
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.', retryAfterSec: seconds }),
    {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': String(seconds) },
    },
  )
}

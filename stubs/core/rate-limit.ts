/**
 * Per-key sliding window. Kept real and in-memory, exactly as the app expects.
 */

import { NextResponse } from 'next/server'

/** key -> timestamps of the hits still inside the window. */
const hits = new Map<string, number[]>()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterMs: number
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - recent[0]) }
  }
  recent.push(now)
  hits.set(key, recent)
  return { ok: true, remaining: limit - recent.length, retryAfterMs: 0 }
}

/** Best-effort client IP, from the proxy headers the real one reads. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? '127.0.0.1'
}

export function tooManyRequests(message = 'Too many requests'): NextResponse {
  return NextResponse.json({ error: message }, { status: 429 })
}

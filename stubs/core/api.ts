/**
 * Route-handler response helpers — real implementations.
 *
 * Nothing here needs a database, and every API route in the app is written
 * against these six, so reproducing them exactly is what keeps the handlers
 * that CAN work (cart, settings, wall) working.
 */

import { NextResponse } from 'next/server'

export function ok<T>(body: T): NextResponse {
  return NextResponse.json(body as object, { status: 200 })
}

export function created<T>(body: T): NextResponse {
  return NextResponse.json(body as object, { status: 201 })
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function conflict(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details }, { status: 409 })
}

export function tooManyRequests(message = 'Too many requests'): NextResponse {
  return NextResponse.json({ error: message }, { status: 429 })
}

export function serviceUnavailable(message = 'Service unavailable'): NextResponse {
  return NextResponse.json({ error: message }, { status: 503 })
}

/**
 * The outer try/catch every handler wraps its body in.
 *
 * The real one reports to Sentry and returns an opaque 500. This one also logs
 * the message to the dev console, because against stubs the most likely throw
 * is `StubUnavailableError` and silently swallowing it would leave you staring
 * at a bare 500 with no clue which module was missing.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api]', message)
    return NextResponse.json({ error: 'Internal Server Error', detail: message }, { status: 500 })
  }
}

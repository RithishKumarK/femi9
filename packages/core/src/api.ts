import { NextResponse } from 'next/server'
import { logger } from './logger'

/**
 * Shared JSON response helpers for route handlers. Keeps success/error envelopes
 * consistent across every /api endpoint.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 })
}

/**
 * `details` carries zod's `flatten()` output so a form can put each message next
 * to its input. `extra` is spread at the TOP level for machine-readable keys the
 * client branches on (e.g. `{ code: 'phone_requires_verification', field: 'phone' }`)
 * — those belong beside `error`, not buried inside a validation payload.
 */
export function badRequest(error: string, details?: unknown, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, details, ...extra }, { status: 400 })
}

export function unauthorized(error = 'Unauthorized') {
  return NextResponse.json({ error }, { status: 401 })
}

export function forbidden(error = 'Forbidden') {
  return NextResponse.json({ error }, { status: 403 })
}

export function notFound(error = 'Not found') {
  return NextResponse.json({ error }, { status: 404 })
}

/**
 * 409 — the request is well-formed but collides with something that already
 * exists. `extra` carries the machine-readable keys the client branches on
 * (e.g. `{ code: 'identity_conflict', field: 'email' }`) so a form can put the
 * message next to the offending input instead of in a generic banner.
 */
export function conflict(error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status: 409 })
}

export function serverError(error = 'Internal server error') {
  return NextResponse.json({ error }, { status: 500 })
}

export function serviceUnavailable(error = 'Service temporarily unavailable') {
  return NextResponse.json({ error }, { status: 503 })
}

/** Wrap a handler body so thrown errors become a 500 instead of crashing. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (err) {
    logger.error('api_unhandled', { err: String(err) })
    return serverError()
  }
}

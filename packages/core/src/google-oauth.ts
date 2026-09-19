import 'server-only'
import { randomBytes } from 'node:crypto'
import { configuredEnv } from './runtime-mode'

/**
 * Google OAuth 2.0 (OpenID Connect) seam — customer sign-in only.
 *
 * Mirrors the other provider seams. A fixed local profile is available only
 * when routes explicitly allow non-production mocks; production fails closed
 * when credentials are missing or still hold Terraform TODO values.
 *
 * This module knows how to (a) build the consent URL, (b) exchange the returned
 * code for tokens, and (c) read the verified profile. It never touches cookies or
 * the DB — the callback route mints the session and the auth service upserts the
 * user, exactly like the OTP / magic-link paths.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

/** Name of the short-lived cookie holding the anti-CSRF state between the start
 *  redirect and the callback. Lives here (not in the route file) because Next.js
 *  route modules may only export handlers/config — not arbitrary constants. */
export const OAUTH_STATE_COOKIE = 'femi9_oauth_state'

/** Name of the short-lived cookie carrying the post-sign-in destination across
 *  the round trip through Google. It cannot ride on the query string: Google
 *  echoes back only `code` and `state`, and `state` is the CSRF nonce we compare
 *  byte-for-byte, so widening it to carry a payload would weaken that check. */
export const OAUTH_NEXT_COOKIE = 'femi9_oauth_next'

/** Live Google only when both credentials contain real, non-placeholder values. */
export function googleConfigured(): boolean {
  return configuredEnv('GOOGLE_CLIENT_ID') && configuredEnv('GOOGLE_CLIENT_SECRET')
}

/** The verified identity we take from Google. Only the fields we actually use. */
export interface GoogleProfile {
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
}

/** Opaque anti-CSRF value tying a callback back to the redirect that started it. */
export function generateState(): string {
  return randomBytes(16).toString('hex')
}

/** The redirect URI Google will send the user back to. Must EXACTLY match one of
 *  the "Authorized redirect URIs" registered on the OAuth client. Canonical
 *  origin first so it's stable behind a proxy/CDN. */
export function callbackUrl(requestOrigin: string): string {
  // GOOGLE_REDIRECT_URI is intentionally the highest-priority override: Google
  // compares this value byte-for-byte with the URI registered on the OAuth
  // client. Keeping it separate from the general site URL avoids accidental
  // mismatches when the app is reached through a preview host or reverse proxy.
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim()
  if (explicit) return explicit

  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || requestOrigin
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`
}

/** Build the Google consent screen URL for the given state + redirect. */
export function buildConsentUrl(state: string, redirectUri: string): string {
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID as string)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('include_granted_scopes', 'true')
  // Always show the account chooser; keeps the flow predictable across accounts.
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

/**
 * MOCK profile used when Google isn't configured. Deterministic so local testing
 * lands on a stable account; the address is unmistakably a test one.
 */
export function mockProfile(): GoogleProfile {
  return {
    email: 'google.tester@femi9.dev',
    emailVerified: true,
    name: 'Google Tester',
    picture: '',
  }
}

/**
 * Exchange an authorization `code` for the user's verified profile. LIVE path
 * only — callers gate on googleConfigured() and use mockProfile() otherwise.
 * Throws on any non-2xx so a real failure surfaces rather than signing in a
 * half-resolved identity.
 */
export async function exchangeCodeForProfile(code: string, redirectUri: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '')
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${detail}`)
  }
  const token = (await tokenRes.json()) as { access_token?: string }
  if (!token.access_token) throw new Error('Google token exchange returned no access_token')

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${token.access_token}` },
  })
  if (!infoRes.ok) {
    const detail = await infoRes.text().catch(() => '')
    throw new Error(`Google userinfo failed (${infoRes.status}): ${detail}`)
  }
  const info = (await infoRes.json()) as {
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }
  if (!info.email) throw new Error('Google userinfo returned no email')

  return {
    email: info.email,
    emailVerified: Boolean(info.email_verified),
    name: info.name,
    picture: info.picture,
  }
}

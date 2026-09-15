#!/usr/bin/env node

/**
 * Femi9 black-box E2E test.
 *
 * This script drives the running Next.js application only through HTTP. It uses
 * real cookies and the same public APIs used by the React UI. Run it
 * against an isolated, seeded local database with Razorpay/MSG91 disabled.
 *
 *   E2E_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
 *
 * It intentionally refuses non-local targets because checkout, OTP, cycle,
 * subscription, review, affiliate, partner, and wall scenarios create data.
 */

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '')
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)
if (!isLocal && process.env.ALLOW_E2E_MUTATIONS !== 'true') {
  throw new Error(`Refusing E2E mutations against non-local URL ${baseUrl}.`)
}


const PRODUCT_SLUG = 'e2e-test-pad'
const PRODUCT_NAME = 'Femi9 E2E Test Pad'
const runId = Date.now().toString(36)
const phone = `9${String(Date.now()).slice(-9)}`

class CookieJar {
  constructor() {
    this.cookies = new Map()
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';')
      const index = pair.indexOf('=')
      if (index < 1) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      const expired = attrs.some((attr) => /^\s*max-age=0\s*$/i.test(attr))
      if (expired || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

const anonymous = new CookieJar()
const shopper = new CookieJar()
const customer = new CookieJar()
const checks = []

async function request(path, { jar = anonymous, json, ...init } = {}) {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  if (json !== undefined) headers.set('content-type', 'application/json')

  const response = await fetch(baseUrl + path, {
    ...init,
    headers,
    body: json === undefined ? init.body : JSON.stringify(json),
    redirect: 'manual',
  })
  jar.absorb(response)
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { response, body }
}

function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
  checks.push(label)
  console.log(`✓ ${label}`)
}

function status(label, result, expected) {
  const actual = result.response.status
  const detail = typeof result.body === 'string' ? result.body.slice(0, 240) : JSON.stringify(result.body)
  check(label, actual === expected, `expected HTTP ${expected}, got ${actual}; ${detail}`)
}

function contains(label, body, text) {
  check(label, typeof body === 'string' && body.includes(text), `missing "${text}"`)
}

async function main() {
  // Infrastructure + public rendering.
  const health = await request('/api/health')
  status('Health endpoint responds', health, 200)
  check('Database reports healthy', health.body?.status === 'ok' && health.body?.db === true)

  const catalog = await request('/api/products')
  status('Catalog API responds', catalog, 200)
  const product = Array.isArray(catalog.body)
    ? catalog.body.find((item) => item.id === PRODUCT_SLUG)
    : null
  check('Seeded product exists in catalog', Boolean(product))
  check('Seeded product is purchasable', Boolean(product?.variants?.length))
  const variantId = product.variants[0].id

  const home = await request('/')
  status('Storefront homepage renders', home, 200)
  contains('Storefront homepage renders product', home.body, PRODUCT_NAME)

  const productPage = await request(`/product/${PRODUCT_SLUG}`)
  status('Product detail page renders', productPage, 200)
  contains('Product detail shows product name', productPage.body, PRODUCT_NAME)

  const blog = await request('/blog')
  status('Blog index renders', blog, 200)
  const affiliatePage = await request('/affiliate')
  status('Affiliate page renders', affiliatePage, 200)
  const partnerPage = await request('/partner')
  status('Partner page renders', partnerPage, 200)
  const wallPage = await request('/periods-wall')
  status('Community wall renders', wallPage, 200)

  // Protected-route behavior before authentication.
  // The ops console moved to apps/admin, so the storefront must no longer serve
  // an admin API at all. Its ABSENCE is the invariant now — a 401 here would
  // mean the old surface came back.
  const goneAdmin = await request('/api/admin/orders')
  check('Storefront no longer serves the admin API', goneAdmin.response.status === 404)
  const protectedAccount = await request('/account')
  status('Account redirects anonymous visitors', protectedAccount, 307)
  // The redirect now carries the requested path so sign-in can return the
  // shopper to it, so the Location is /login?next=/account rather than a bare
  // /login. Assert the path and that the destination survives — that return
  // trip is the behaviour worth pinning.
  const accountRedirect = protectedAccount.response.headers.get('location')
  const accountRedirectUrl = accountRedirect ? new URL(accountRedirect, baseUrl) : null
  check(
    'Account redirect points to login',
    accountRedirectUrl?.pathname === '/login',
  )
  check(
    'Account redirect preserves the destination',
    accountRedirectUrl?.searchParams.get('next') === '/account',
  )

  // Guest cart -> checkout -> mock Razorpay capture -> confirmation.
  const add = await request('/api/cart', {
    jar: shopper,
    method: 'POST',
    json: { variantId, qty: 1 },
  })
  status('Guest can add a product to cart', add, 200)
  check('Cart contains the selected variant', add.body?.items?.some((item) => item.variantId === variantId))

  const checkoutPage = await request('/checkout', { jar: shopper })
  status('Checkout page renders populated cart', checkoutPage, 200)
  contains('Checkout page contains product', checkoutPage.body, PRODUCT_NAME)

  const checkout = await request('/api/checkout', {
    jar: shopper,
    method: 'POST',
    json: {
      name: 'Femi9 E2E Buyer',
      phone,
      email: `buyer-${runId}@example.test`,
      line: '1 E2E Test Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
    },
  })
  status('Checkout creates an order', checkout, 201)
  check('Checkout returns an order number', typeof checkout.body?.orderNo === 'string')
  check('Checkout returns a confirmation token', typeof checkout.body?.token === 'string')
  check('Isolated E2E server is in mock payment mode', checkout.body?.payment?.configured === false)

  const rejectedRetry = await request(
    `/api/orders/${encodeURIComponent(checkout.body.orderNo)}/payment-intent`,
    {
      jar: shopper,
      method: 'POST',
      json: { token: 'wrong-token' },
    },
  )
  status('Payment retry rejects an invalid order capability', rejectedRetry, 404)

  const retry = await request(
    `/api/orders/${encodeURIComponent(checkout.body.orderNo)}/payment-intent`,
    {
      jar: shopper,
      method: 'POST',
      json: { token: checkout.body.token },
    },
  )
  status('Pending order payment retry succeeds', retry, 200)
  check(
    'Payment retry returns the original secure intent',
    retry.body?.payment?.razorpayOrderId === checkout.body?.payment?.razorpayOrderId,
  )

  const verify = await request('/api/payments/verify', {
    jar: shopper,
    method: 'POST',
    json: { orderNo: checkout.body.orderNo, mock: true },
  })
  status('Mock payment capture succeeds', verify, 200)
  check('Mock payment marks order paid', verify.body?.status === 'paid')

  const confirmation = await request(
    `/order/${encodeURIComponent(checkout.body.orderNo)}?t=${encodeURIComponent(checkout.body.token)}`,
    { jar: shopper },
  )
  status('Order confirmation renders', confirmation, 200)
  contains('Order confirmation shows order number', confirmation.body, checkout.body.orderNo)

  // Customer OTP -> session -> cycle logs -> subscription.
  const otpRequest = await request('/api/auth/otp/request', {
    jar: customer,
    method: 'POST',
    json: { phone },
  })
  status('OTP request succeeds', otpRequest, 200)
  check('OTP provider is mocked for isolated E2E', otpRequest.body?.mock === true)
  check('Mock OTP is returned for testing', typeof otpRequest.body?.devCode === 'string')

  const otpVerify = await request('/api/auth/otp/verify', {
    jar: customer,
    method: 'POST',
    json: { phone, code: otpRequest.body.devCode },
  })
  status('OTP verification creates customer session', otpVerify, 200)

  const me = await request('/api/auth/me', { jar: customer })
  status('Authenticated customer endpoint responds', me, 200)
  check('Authenticated customer is returned', Boolean(me.body?.user?.id))

  const today = new Date().toISOString().slice(0, 10)

  // Health data is gated on explicit consent. Prove the gate holds before
  // granting it — a fresh account must not be able to write period data.
  const beforeConsent = await request('/api/cycle/periods', {
    jar: customer,
    method: 'POST',
    json: { startDate: today, lengthDays: 5 },
  })
  status('Cycle logging is refused before consent', beforeConsent, 403)
  check('Refusal identifies the missing consent', beforeConsent.body?.code === 'consent_required')

  const consent = await request('/api/cycle', { jar: customer, method: 'PATCH', json: { consent: true } })
  status('Customer can grant cycle consent', consent, 200)

  const period = await request('/api/cycle/periods', {
    jar: customer,
    method: 'POST',
    json: { startDate: today, lengthDays: 5 },
  })
  status('Customer can log a period', period, 201)

  const symptom = await request('/api/cycle/symptoms', {
    jar: customer,
    method: 'POST',
    json: { date: today, symptom: 'Cramps', level: 2 },
  })
  status('Customer can log a symptom', symptom, 201)

  const cycle = await request('/api/cycle', { jar: customer })
  status('Customer cycle model responds', cycle, 200)
  check('Cycle model contains the logged period', cycle.body?.periods?.some((item) => item.start === today))

  const subscription = await request('/api/subscriptions', {
    jar: customer,
    method: 'POST',
    json: { variantId, qty: 1, cadenceCode: '4w' },
  })
  status('Customer can create a subscription', subscription, 201)

  const subscriptions = await request('/api/subscriptions', { jar: customer })
  status('Customer subscriptions list responds', subscriptions, 200)
  check('Created subscription is listed', subscriptions.body?.subscriptions?.length >= 1)

  const account = await request('/account', { jar: customer })
  status('Authenticated account page renders', account, 200)
  const dashboard = await request('/dashboard', { jar: customer })
  status('Authenticated dashboard renders', dashboard, 200)

  // Public growth/content write paths. All created content remains pending/test-labelled.
  const review = await request('/api/reviews', {
    method: 'POST',
    json: {
      productSlug: PRODUCT_SLUG,
      name: 'E2E Reviewer',
      rating: 5,
      body: `Automated E2E review ${runId}`,
      place: 'Test City',
    },
  })
  status('Product review submission succeeds', review, 200)

  const wall = await request('/api/wall', {
    method: 'POST',
    json: {
      alias: 'E2E Tester',
      isAnonymous: false,
      product: PRODUCT_NAME,
      rating: 5,
      body: `Automated E2E wall submission ${runId}`,
      tags: ['e2e'],
    },
  })
  status('Community wall submission succeeds', wall, 201)
  check('Community submission is moderated', wall.body?.status === 'pending')

  const affiliate = await request('/api/affiliate/apply', {
    method: 'POST',
    json: {
      name: 'E2E Affiliate',
      handle: `e2e_${runId}`,
      platform: 'Instagram',
      followerBand: 'Test',
      email: `affiliate-${runId}@example.test`,
    },
  })
  status('Affiliate application succeeds', affiliate, 201)

  const partner = await request('/api/partner/apply', {
    method: 'POST',
    json: {
      name: 'E2E Partner',
      phone,
      city: 'Chennai',
      situation: 'Testing',
      reason: `Automated E2E partner application ${runId}`,
    },
  })
  status('Partner application succeeds', partner, 200)

  // Thara Model — enrol / share / attribute. Only runs when THARA_ENABLED is on
  // in the server process. When off, every route 404s; we skip cleanly.
  const tharaProbe = await request('/api/thara/me', { jar: customer })
  if (tharaProbe.response.status === 404) {
    console.log('~ Thara routes are 404 (THARA_ENABLED off) — skipping Thara block')
  } else {
    const tharaEnroll = await request('/api/thara/enroll', {
      jar: customer,
      method: 'POST',
      json: { termsVersion: 'v1' },
    })
    status('Thara enrol succeeds', tharaEnroll, 200)
    check(
      'Thara enrol issues a valid 4-letter/4-digit code',
      /^[A-HJ-NP-Z]{4}[2-9]{4}$/.test(tharaEnroll.body?.referralCode ?? ''),
    )

    const tharaMe = await request('/api/thara/me', { jar: customer })
    status('Thara me returns enrolled state', tharaMe, 200)
    check(
      'Thara me exposes the same referral code',
      tharaMe.body?.referralCode === tharaEnroll.body?.referralCode,
    )

    const friend = new CookieJar()
    const rr = await request(`/r/${tharaEnroll.body.referralCode}`, { jar: friend })
    status('Referral link redirects', rr, 302)
    check('Referral link sets the thara_ref cookie', friend.cookies.has('femi9_thara_ref'))
  }

  console.log(`\n${checks.length} E2E checks passed against ${baseUrl}.`)
}

main().catch((error) => {
  console.error(`\nE2E FAILED: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})

import 'server-only'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Settings service — the single source for editable business config, replacing
 * the hardcoded FREE_SHIP / SUBSCRIBE_PCT / WA_NUMBER constants that used to
 * live in src/data/products.ts. Values are stored as loose `Json` rows keyed by
 * name; this seam gives the rest of the app a typed, defaulted view so a missing
 * or malformed row can never break the storefront.
 */

export interface Settings {
  freeShipThreshold: number
  subscribeSavePct: number
  whatsappNumber: string
  pointsPerRupee: number
  firstOrderBonusPoints: number
}

/** Defaults mirror the original constants so behaviour is unchanged when a row is absent. */
const DEFAULTS: Settings = {
  freeShipThreshold: 999,
  subscribeSavePct: 15,
  whatsappNumber: '919042916499',
  pointsPerRupee: 1,
  firstOrderBonusPoints: 100,
}

/** Coerce a Json cell to the shape of its default, tolerating string/number drift. */
function coerce<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof fallback === 'number') {
    const n = typeof value === 'string' ? Number(value) : value
    return (typeof n === 'number' && Number.isFinite(n) ? n : fallback) as T
  }
  if (typeof fallback === 'string') {
    return (typeof value === 'string' ? value : String(value)) as T
  }
  return (value as T) ?? fallback
}

/** All settings as a typed object, filling any missing key from DEFAULTS. */
export async function getSettings(brand: Brand): Promise<Settings> {
  const prisma = dbFor(brand)
  const rows = await prisma.setting.findMany()
  const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]))
  return {
    freeShipThreshold: coerce(byKey.get('freeShipThreshold'), DEFAULTS.freeShipThreshold),
    subscribeSavePct: coerce(byKey.get('subscribeSavePct'), DEFAULTS.subscribeSavePct),
    whatsappNumber: coerce(byKey.get('whatsappNumber'), DEFAULTS.whatsappNumber),
    pointsPerRupee: coerce(byKey.get('pointsPerRupee'), DEFAULTS.pointsPerRupee),
    firstOrderBonusPoints: coerce(byKey.get('firstOrderBonusPoints'), DEFAULTS.firstOrderBonusPoints),
  }
}

/** One shoppable product, for the footer column and any other nav-level list. */
export interface ShopLink {
  slug: string
  name: string
}

/**
 * Everything the storefront chrome needs from the server in one call.
 *
 * Extends `Settings` with the two provider flags and the real catalog, because
 * every consumer of them is a client component:
 *  - `googleEnabled` stops /login rendering a prominent "Continue with Google"
 *    button that bounces the shopper back with ?error=google-config.
 *  - `tharaEnabled` lets Nav and Footer show /thara only when the programme is
 *    actually switched on. Until now nothing in the product linked to it at all.
 *  - `shopLinks` replaces three hardcoded slugs in the footer, which turned into
 *    404s on every page the moment a product was archived or renamed.
 */
export interface PublicSettingsPayload extends Settings {
  googleEnabled: boolean
  tharaEnabled: boolean
  shopLinks: ShopLink[]
}

export async function getPublicSettings(brand: Brand): Promise<PublicSettingsPayload> {
  const prisma = dbFor(brand)
  // Imported lazily so this module stays free of the OAuth/feature-flag graph
  // for the many server callers that only want the business numbers.
  const [{ googleConfigured }, { isTharaEnabled }] = await Promise.all([
    import('../google-oauth'),
    import('../thara/feature'),
  ])
  const [settings, products] = await Promise.all([
    getSettings(brand),
    prisma.product.findMany({
      where: { status: 'active' },
      orderBy: [{ basePrice: 'desc' }],
      take: 3,
      select: { slug: true, name: true },
    }),
  ])
  return {
    ...settings,
    googleEnabled: googleConfigured(),
    tharaEnabled: isTharaEnabled(),
    shopLinks: products,
  }
}

/** Generic single-key getter — returns `fallback` when the row is missing or malformed. */
export async function getSetting<T>(brand: Brand, key: string, fallback: T): Promise<T> {
  const prisma = dbFor(brand)
  const row = await prisma.setting.findUnique({ where: { key } })
  return coerce(row?.value as unknown, fallback)
}

// ─────────────────────────── Launch popup ───────────────────────────
/**
 * The storefront's launch-offer popup — one image (a GIF, usually), shown once
 * per visit and dismissible with an X.
 *
 * It lives in its OWN `Setting` row, as a single Json object, rather than as
 * four more scalar keys next to `freeShipThreshold`. Two reasons:
 *
 *  - The four fields are only ever read together and only ever written
 *    together. Splitting them across rows means a save that half-applies can
 *    leave the popup enabled with the previous campaign's artwork still in it.
 *  - `Settings` above is deliberately flat scalars, because `coerce()` decides
 *    what a cell means from the SHAPE of its default. An object default would
 *    fall through to its `?? fallback` branch and hand the storefront whatever
 *    JSON happened to be in the row — including a missing `seconds`, which is a
 *    popup that never closes on its own.
 *
 * `normalizeLaunchPopup` is therefore the only way this value is read: every
 * field is checked and defaulted individually, so a hand-edited or partially
 * written row degrades to "no popup" instead of to a broken one.
 */
export interface LaunchPopup {
  /** Master switch. The storefront also needs `imageUrl` — see `isLaunchPopupLive`. */
  enabled: boolean
  /** A managed image URL (`/uploads/…`), from the console's upload button. */
  imageUrl: string | null
  /** Read in place of the image. Empty means decorative, which a promo is not. */
  alt: string
  /** Auto-dismiss after this many seconds. `0` = stays until she closes it. */
  seconds: number
}

/** The single `Setting` row this config is stored under. */
export const LAUNCH_POPUP_KEY = 'launchPopup'

/** No popup, and a sane duration for the first admin who switches one on. */
export const LAUNCH_POPUP_DEFAULT: LaunchPopup = {
  enabled: false,
  imageUrl: null,
  alt: '',
  seconds: 8,
}

/** Longest auto-dismiss the console accepts. Beyond a minute "auto-dismiss" is
 *  a fiction — use `0` (stays until closed), which says so honestly. */
export const LAUNCH_POPUP_MAX_SECONDS = 60

/**
 * Coerce an arbitrary Json cell into a whole `LaunchPopup`.
 *
 * Free of `dbFor` and of any I/O so the console's form, the API route and the
 * storefront read can all share one definition of what a stored popup means.
 */
export function normalizeLaunchPopup(value: unknown): LaunchPopup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return LAUNCH_POPUP_DEFAULT
  const row = value as Record<string, unknown>

  const imageUrl = typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim() : null

  // A number that arrived as a string ("8") is still a duration; NaN, Infinity
  // and a negative are not, and each of them would disable the auto-dismiss
  // timer silently rather than visibly.
  const rawSeconds = typeof row.seconds === 'string' ? Number(row.seconds) : row.seconds
  const seconds =
    typeof rawSeconds === 'number' && Number.isFinite(rawSeconds) && rawSeconds >= 0
      ? Math.min(Math.trunc(rawSeconds), LAUNCH_POPUP_MAX_SECONDS)
      : LAUNCH_POPUP_DEFAULT.seconds

  return {
    enabled: row.enabled === true,
    imageUrl,
    alt: typeof row.alt === 'string' ? row.alt.trim() : '',
    seconds,
  }
}

/**
 * Whether this config should actually render.
 *
 * `enabled` alone is not enough: an admin who switches the popup on before
 * uploading the artwork would otherwise get a modal with a broken image in it,
 * over the whole storefront, on every visitor's first page.
 */
export function isLaunchPopupLive(popup: LaunchPopup): popup is LaunchPopup & { imageUrl: string } {
  return popup.enabled && !!popup.imageUrl
}

/** The brand's popup config, defaulted. One row, one query. */
export async function getLaunchPopup(brand: Brand): Promise<LaunchPopup> {
  const prisma = dbFor(brand)
  const row = await prisma.setting.findUnique({ where: { key: LAUNCH_POPUP_KEY } })
  return normalizeLaunchPopup(row?.value as unknown)
}

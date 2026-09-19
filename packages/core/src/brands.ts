import { BRANDS, isBrand, type Brand } from '@femi9/db'

export { BRANDS, isBrand }
export type { Brand }

/**
 * What each brand's console is allowed to contain.
 *
 * A module absent from a brand's list is not merely hidden from the nav — the
 * route returns 404. Lumi9's staff should not learn that Thara exists by
 * guessing a URL, and 403 tells them it does. Hiding a link is decoration;
 * the check that matters is on the route.
 */
export const ADMIN_MODULES = [
  'dashboard',
  'catalog',
  'inventory',
  'orders',
  'customers',
  'coupons',
  'pricing',
  'subscriptions',
  'content',
  'reviews',
  'community',
  'affiliates',
  'partners',
  'thara',
  // Lumi9 only: the /parenting-tools schedule and its care-plan leads. Femi9
  // has no such page, so the route 404s there rather than rendering an empty
  // console screen for a feature that brand does not have.
  'parenting',
  'settings',
  // Team (admin user management). Both brands have it; every role EXCEPT
  // super_admin/owner has null in admin-policy.ts → the nav hides it + the
  // page 404s for everyone else.
  'team',
] as const

export type AdminModule = (typeof ADMIN_MODULES)[number]

/** The Prisma ProductType values. A brand sells some of them, never all. */
export const PRODUCT_TYPES = ['pad', 'panty', 'diaper'] as const
export type ProductTypeValue = (typeof PRODUCT_TYPES)[number]

export interface BrandConfig {
  key: Brand
  name: string
  /** Shown on the login toggle and in the console header. */
  shortName: string
  /**
   * The one-line sign-off under a transactional email.
   *
   * Here rather than in the mail templates because there is one template and
   * two brands. `order-mail.ts` printed "Femi9 · organic period care" as a
   * literal, so every Lumi9 order confirmation — for baby diapers — was signed
   * off as period care from the other company, under a subject line that also
   * said Femi9. The customer had never heard of Femi9.
   */
  tagline: string
  /** Public storefront host, for "view site" links. */
  host: string
  accent: string
  accentInk: string
  modules: readonly AdminModule[]
  /**
   * Prefix for customer-facing order numbers. Brand-specific because the
   * shopper reads it back to support, and because the two brands' sequences
   * live in different schemas and must not look interchangeable.
   */
  orderPrefix: string
  /**
   * What this brand actually sells. The console's product form renders its
   * options from here, and the routes reject anything outside it — a Lumi9
   * admin has no business creating a sanitary pad, and the shared enum would
   * otherwise let them.
   */
  productTypes: readonly ProductTypeValue[]
  /**
   * How many products this brand's landing page features — and therefore how
   * many the console will let an admin flag at once.
   *
   * A number rather than a shared constant because it is a LAYOUT fact, and the
   * two landing pages are not the same page. Femi9's rail is a row of cards
   * chosen by an editor. Lumi9's "Cloud Soft range" is the size run: it must
   * show every size a baby can grow into, so picking a subset there is not a
   * feature, it is a hole in the size chart. `0` means the brand has no rail —
   * the console hides the control and the routes refuse the flag, rather than
   * offering a toggle that changes nothing a shopper sees.
   */
  featuredSlots: number
  /**
   * Whether this brand's storefront renders the launch popup.
   *
   * Same reasoning as `featuredSlots: 0` above, and the same rule: the console
   * hides the control and the route refuses the field, rather than offering a
   * switch that changes nothing a shopper sees. `apps/lumi9-web` reads the
   * `launchPopup` Setting row in its root layout; the Femi9 storefront has no
   * such surface, so an admin there could switch on a promo that never appears
   * and have no way to tell it had not.
   *
   * Turning it on for Femi9 means adding the component to that app FIRST — the
   * flag follows the storefront, it does not create it.
   */
  launchPopup: boolean
}

export const BRAND_CONFIG: Record<Brand, BrandConfig> = {
  femi9: {
    key: 'femi9',
    name: 'Femi9',
    shortName: 'Femi9',
    host: 'femi9.in',
    tagline: 'Femi9 · organic period care',
    accent: '#352D78',
    accentInk: '#ffffff',
    orderPrefix: 'FM',
    productTypes: ['pad', 'panty'],
    // The landing page's "Choose Your Perfect Fit" rail.
    featuredSlots: 5,
    // No popup surface in apps/femi9-web — see the note on the field.
    launchPopup: false,
    modules: [
      'dashboard',
      'catalog',
      'inventory',
      'orders',
      'customers',
      'coupons',
      'pricing',
      'subscriptions',
      'content',
      'reviews',
      'community',
      'affiliates',
      'partners',
      'thara',
      'settings',
      'team',
    ],
  },
  lumi9: {
    key: 'lumi9',
    name: 'Lumi9',
    shortName: 'Lumi9',
    host: 'lumi9.in',
    tagline: 'Lumi9 · cloud soft baby care',
    accent: '#4F6F52',
    accentInk: '#ffffff',
    orderPrefix: 'LM',
    productTypes: ['diaper'],
    // The root layout renders it, once per visit, over whatever page she landed on.
    launchPopup: true,
    // No rail. The homepage's product section IS the size run — see the note on
    // BrandConfig.featuredSlots.
    featuredSlots: 0,
    // No community, partners or thara: those are Femi9 programmes, and the
    // Lumi9 database has no rows for them.
    //
    // No `pricing` either. Lumi9 does not run price zones: a diaper costs the
    // same wherever the baby lives, so there is nothing for a zone screen to
    // edit. The seeded Default zone stays — it is what the storefront prices
    // against at 0% — but it is not something this console offers to change.
    //
    // `affiliates` IS here, and is not the same programme as Femi9's. Lumi9
    // runs its own creator roster in its own schema: an application from
    // lumi9.in writes a `lumi9` Affiliate row, a code approved in this console
    // works only on Lumi9 links, and neither brand's console or storefront can
    // resolve the other's codes. Sharing the module name shares the service and
    // the review screen - never the creators, the codes or the earnings.
    modules: [
      'dashboard',
      'catalog',
      'inventory',
      'orders',
      'customers',
      'coupons',
      'subscriptions',
      'content',
      'reviews',
      'affiliates',
      // Lumi9's parenting tools: the published vaccination schedule and the
      // care-plan leads. Femi9 has no such page — its tools surface does not
      // exist — so the module is Lumi9's alone and the route 404s over there.
      'parenting',
      'settings',
      'team',
    ],
  },
}

export function brandConfig(brand: Brand): BrandConfig {
  return BRAND_CONFIG[brand]
}

/** Whether a brand's console includes a module. The route guard calls this. */
export function hasModule(brand: Brand, moduleName: AdminModule): boolean {
  return BRAND_CONFIG[brand].modules.includes(moduleName)
}

/**
 * Whether a brand may sell this product type.
 *
 * The Prisma enum is shared across brands, so without this check a crafted
 * request could file a diaper under Femi9. Validation at the boundary knows the
 * union; only this knows which member belongs to whom.
 */
export function allowsProductType(brand: Brand, type: string): type is ProductTypeValue {
  return (BRAND_CONFIG[brand].productTypes as readonly string[]).includes(type)
}

/**
 * How many products this brand's landing page features. `0` means it has no
 * featured rail at all — see the note on `BrandConfig.featuredSlots`.
 *
 * Both the storefront read and the console write go through this, so "five" is
 * one number in one place rather than a literal in a `take:`, a literal in a
 * `slice()` and a third in a validation message.
 */
export function featuredSlots(brand: Brand): number {
  return BRAND_CONFIG[brand].featuredSlots
}

/** Whether a brand has a featured rail to put products on. */
export function allowsFeatured(brand: Brand): boolean {
  return BRAND_CONFIG[brand].featuredSlots > 0
}

/** Whether a brand's storefront shows the launch popup. Both the console's card
 *  and the settings route ask this — one answer, two enforcement points. */
export function hasLaunchPopup(brand: Brand): boolean {
  return BRAND_CONFIG[brand].launchPopup
}

/** The `FM-00001` / `LM-00001` prefix for this brand's order numbers. */
export function orderPrefix(brand: Brand): string {
  return BRAND_CONFIG[brand].orderPrefix
}

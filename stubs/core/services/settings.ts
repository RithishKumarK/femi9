/**
 * Store settings — the console-editable knobs, served as their shipped defaults.
 *
 * `getPublicSettings` backs `/api/settings`, which `usePublicSettings()` polls
 * on every page, so this one has to be right or the free-shipping bar, the
 * subscribe-and-save percentage and the footer's shop links all render wrong.
 * The shop links are derived from the catalogue fixture rather than hardcoded,
 * for the same reason the real service reads them from the database: a slug
 * written down twice is a slug that eventually 404s.
 */

import type { Brand } from '../../db'
import { listProducts } from './products'

export interface ShopLink {
  slug: string
  name: string
}

export interface StoreSettings {
  freeShipThreshold: number
  subscribeSavePct: number
  whatsappNumber: string
  supportEmail: string
  codEnabled: boolean
  gstPct: number
}

export interface PublicSettings {
  freeShipThreshold: number
  subscribeSavePct: number
  whatsappNumber: string
  googleEnabled: boolean
  tharaEnabled: boolean
  shopLinks: ShopLink[]
}

const SETTINGS: StoreSettings = {
  freeShipThreshold: 999,
  subscribeSavePct: 15,
  whatsappNumber: '919042916499',
  supportEmail: 'support@femi9.in',
  codEnabled: true,
  gstPct: 0,
}

export async function getSettings(_brand: Brand): Promise<StoreSettings> {
  return SETTINGS
}

export async function getPublicSettings(brand: Brand): Promise<PublicSettings> {
  const products = await listProducts(brand)
  return {
    freeShipThreshold: SETTINGS.freeShipThreshold,
    subscribeSavePct: SETTINGS.subscribeSavePct,
    whatsappNumber: SETTINGS.whatsappNumber,
    // No Google client is configured against a stub, and /login's Google button
    // would bounce the shopper straight back with an error.
    googleEnabled: false,
    tharaEnabled: process.env.THARA_ENABLED === 'true',
    shopLinks: products.map((p) => ({ slug: p.id, name: p.name })),
  }
}

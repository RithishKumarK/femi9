'use client'

import { useEffect, useState } from 'react'

/** One shoppable product, mirrored from services/settings ShopLink. */
export interface ShopLink {
  slug: string
  name: string
}

export interface PublicSettings {
  freeShipThreshold: number
  subscribeSavePct: number
  whatsappNumber: string
  /** False when GOOGLE_CLIENT_ID/SECRET are absent — /login must not render the
   *  Google button, which would bounce the shopper back with an error. */
  googleEnabled: boolean
  /** False unless THARA_ENABLED is on. Nav/Footer hide the /thara link. */
  tharaEnabled: boolean
  /** The real catalog. Empty until the fetch resolves; render nothing rather
   *  than a hardcoded slug that 404s the moment a product is archived. */
  shopLinks: ShopLink[]
}

const DEFAULTS: PublicSettings = {
  freeShipThreshold: 999,
  subscribeSavePct: 15,
  whatsappNumber: '919042916499',
  // Both flags default OFF: showing a control that turns out not to work is
  // worse than showing it a moment late.
  googleEnabled: false,
  tharaEnabled: false,
  shopLinks: [],
}

export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState(DEFAULTS)
  useEffect(() => {
    let active = true
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!active) return
        setSettings({
          freeShipThreshold: Number(data.freeShipThreshold) || DEFAULTS.freeShipThreshold,
          subscribeSavePct: Number(data.subscribeSavePct) || DEFAULTS.subscribeSavePct,
          whatsappNumber: String(data.whatsappNumber || DEFAULTS.whatsappNumber),
          googleEnabled: data.googleEnabled === true,
          tharaEnabled: data.tharaEnabled === true,
          shopLinks: Array.isArray(data.shopLinks)
            ? (data.shopLinks as ShopLink[]).filter((l) => l && l.slug && l.name)
            : [],
        })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return settings
}

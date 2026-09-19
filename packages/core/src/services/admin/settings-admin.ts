import 'server-only'
import { Prisma } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'
import {
  getLaunchPopup,
  getSettings,
  LAUNCH_POPUP_KEY,
  normalizeLaunchPopup,
  type LaunchPopup,
  type Settings,
} from '../settings'

/**
 * Admin settings service — the write-side of the "customizable backend".
 *
 * Reads reuse getSettings(brand) so the editor and the live storefront always agree
 * on what "current" means (a missing row shows its baked-in default, never a
 * blank). Writes upsert one Setting row per changed key; numeric fields are
 * stored as whole-number Json so the storefront reads back an Int, not a
 * "225"-style string that would only survive because getSettings(brand) coerces it.
 */

// The only keys this editor may write. Numeric ones are truncated to Int before
// storage; whatsappNumber is a free-form string. Anything else in the Setting
// table (future flags, etc.) is out of scope and left untouched.
const NUMERIC_KEYS = new Set<keyof Settings>([
  'freeShipThreshold',
  'subscribeSavePct',
  'pointsPerRupee',
  'firstOrderBonusPoints',
])

export type SettingsPatch = Partial<Settings>

/**
 * What the console's one settings screen edits: the business numbers plus the
 * launch popup, which is a Json row rather than a scalar and so cannot join
 * `Settings` itself. One payload because it is one form with one Save button —
 * an admin switching the popup on should not have to remember that the number
 * above it saves through a different request.
 */
export interface ConsoleSettings extends Settings {
  launchPopup: LaunchPopup
}

export interface ConsoleSettingsPatch extends SettingsPatch {
  launchPopup?: LaunchPopup
}

/** Current editable settings, defaulted — the form's initial values. */
export async function getEditableSettings(brand: Brand): Promise<ConsoleSettings> {
  const [settings, launchPopup] = await Promise.all([getSettings(brand), getLaunchPopup(brand)])
  return { ...settings, launchPopup }
}

/**
 * Upsert the provided settings and return the fresh, defaulted view. Runs the
 * upserts in one transaction so a partial failure never leaves the config in a
 * half-applied state.
 */
export async function updateSettings(
  brand: Brand,
  patch: ConsoleSettingsPatch,
): Promise<ConsoleSettings> {
  const prisma = dbFor(brand)
  const { launchPopup, ...scalars } = patch
  const ops = (Object.entries(scalars) as [keyof Settings, Settings[keyof Settings]][])
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      // Coerce numeric keys to Int here (belt-and-braces alongside the zod layer)
      // so storage stays typed regardless of how the caller reached this service.
      const stored: Prisma.InputJsonValue = NUMERIC_KEYS.has(key)
        ? Math.trunc(Number(value))
        : (value as string)
      return prisma.setting.upsert({
        where: { key },
        create: { key, value: stored },
        update: { value: stored },
      })
    })

  // The popup is one whole Json object in one row, so it is upserted as itself
  // rather than field by field — and normalised on the way IN as well as on the
  // way out, so the row can never hold a shape `getLaunchPopup` would have to
  // fall back from. Same transaction as the scalars: one Save, one outcome.
  if (launchPopup !== undefined) {
    const stored = normalizeLaunchPopup(launchPopup) as unknown as Prisma.InputJsonValue
    ops.push(
      prisma.setting.upsert({
        where: { key: LAUNCH_POPUP_KEY },
        create: { key: LAUNCH_POPUP_KEY, value: stored },
        update: { value: stored },
      }),
    )
  }

  if (ops.length) await prisma.$transaction(ops)

  return getEditableSettings(brand)
}

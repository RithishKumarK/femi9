import { ok, handle } from '@femi9/core/api'
import { getPublicSettings } from '@femi9/core/services/settings'

/**
 * GET /api/settings — the storefront's public config.
 *
 * Carries the editable business numbers plus `googleEnabled`, `tharaEnabled`
 * and the real shop links, so client chrome (Nav, Footer, /login) stops
 * rendering controls for things this deployment does not have switched on.
 * Nothing here is secret; every value is already visible in the UI it drives.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => ok(await getPublicSettings('femi9')))
}

/**
 * Voucher issuance.
 */

import { unavailable } from '../_unavailable'

export const ManualIssuer = {
  issue: async (): Promise<never> => unavailable('Thara voucher issuance'),
  name: 'manual' as const,
}

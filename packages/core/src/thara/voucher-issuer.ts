import 'server-only'

/**
 * VoucherIssuer — how an Amazon voucher's code is minted at cycle close.
 *
 * Two implementations:
 *   - AmazonIncentivesIssuer: real Amazon Incentives API. Requires a signed
 *     business agreement and API credentials (AWS_INCENTIVES_ACCESS_KEY_ID
 *     and _SECRET_ACCESS_KEY, plus INCENTIVES_PARTNER_ID). See
 *     https://developer.amazon.com/apps-and-games/incentives-api. Not usable
 *     until Amazon completes the onboarding review (typically 2–4 weeks).
 *   - ManualIssuer: leaves voucher.amazonCode null; admin pastes the code
 *     later via /api/admin/thara/vouchers/[id]/set-code. Suitable for MVP.
 *
 * Selection happens at cycle-close time by reading THARA_VOUCHER_ISSUER env:
 *   "amazon"  → AmazonIncentivesIssuer  (throws if creds missing)
 *   default   → ManualIssuer
 */

export interface VoucherIssueRequest {
  valuePaise: number
  userEmail: string | null
  userName: string | null
  externalReference: string // for tracing (voucher id)
}

export interface VoucherIssueResult {
  /** Amazon gift-code, or null when the issuer defers (manual mode). */
  amazonCode: string | null
}

export interface VoucherIssuer {
  issue(req: VoucherIssueRequest): Promise<VoucherIssueResult>
}

export class ManualIssuer implements VoucherIssuer {
  async issue(_req: VoucherIssueRequest): Promise<VoucherIssueResult> {
    return { amazonCode: null }
  }
}

export class AmazonIncentivesIssuer implements VoucherIssuer {
  async issue(_req: VoucherIssueRequest): Promise<VoucherIssueResult> {
    const key = process.env.AWS_INCENTIVES_ACCESS_KEY_ID
    const secret = process.env.AWS_INCENTIVES_SECRET_ACCESS_KEY
    const partner = process.env.INCENTIVES_PARTNER_ID
    if (!key || !secret || !partner) {
      // Onboarding pending → surface a clear signal that cycle close should
      // fall through to manual issuance rather than fail.
      throw new AmazonIncentivesNotConfiguredError()
    }
    // Full CreateGiftCard call goes here when creds are ready. Left as an
    // intentional NotImplementedError to make it explicit in tests and code
    // review that this path needs the real Amazon SDK + AWS SigV4 signing
    // before it's live.
    throw new AmazonIncentivesNotImplementedError()
  }
}

export class AmazonIncentivesNotConfiguredError extends Error {
  constructor() {
    super('Amazon Incentives API credentials are not configured.')
    this.name = 'AmazonIncentivesNotConfiguredError'
  }
}
export class AmazonIncentivesNotImplementedError extends Error {
  constructor() {
    super('Amazon Incentives API integration is not implemented yet - use the manual issuer.')
    this.name = 'AmazonIncentivesNotImplementedError'
  }
}

export function selectVoucherIssuer(): VoucherIssuer {
  if ((process.env.THARA_VOUCHER_ISSUER ?? '').toLowerCase() === 'amazon') {
    return new AmazonIncentivesIssuer()
  }
  return new ManualIssuer()
}

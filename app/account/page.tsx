import { redirect } from 'next/navigation'
import { getSession } from '@femi9/core/auth'
import { getAccountData } from '@femi9/core/services/account'
import { listRewardOptions } from '@femi9/core/services/rewards'
import { Account } from '@/screens/Account'

// Reads the session cookie + per-user DB rows, so it must render per request.
export const dynamic = 'force-dynamic'

/**
 * /account — the signed-in customer's home. Middleware already gate-keeps this
 * path, but we resolve the session again here (Node runtime) to fetch the real
 * data, and we re-run the onboarding gate: an account that never captured a
 * name / email / phone cannot render a member surface honestly, so it is sent
 * to /welcome. Typing the URL does not bypass that.
 */
export default async function AccountPage() {
  const s = await getSession('femi9')
  // Carry the destination so /login returns the customer here rather than
  // dropping them on a generic landing after they sign in.
  if (!s) redirect('/login?next=/account')

  const [data, rewardOptions] = await Promise.all([getAccountData('femi9', s.sub), listRewardOptions('femi9')])
  // A valid token whose user row is gone — bounce rather than render half a page.
  if (!data) redirect('/login')
  if (!data.user.profileComplete) redirect('/welcome')

  return (
    <Account
      user={data.user}
      pointsBalance={data.pointsBalance}
      orders={data.orders}
      addresses={data.addresses}
      subscriptions={data.subscriptions}
      coupons={data.coupons}
      earnRates={data.earnRates}
      spendTrend={data.spendTrend}
      activity={data.activity}
      rewardOptions={rewardOptions}
    />
  )
}

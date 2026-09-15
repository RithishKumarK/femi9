import { redirect } from 'next/navigation'
import { getSession } from '@femi9/core/auth'
import { getAccountData, getProfileStatus } from '@femi9/core/services/account'
import { getCycleData } from '@femi9/core/services/cycle'
import { listRewardOptions } from '@femi9/core/services/rewards'
import { UserDashboard } from '@/screens/UserDashboard'

/**
 * Customer dashboard (server component). Reading the session via cookies() opts
 * this route into dynamic rendering, so it is always evaluated against the
 * current request — never statically cached and served to the wrong shopper.
 *
 * The identity handed to the screen is the SAME `AccountUser` /account renders.
 * The dashboard used to fetch its own name and then let the shared Shell fetch a
 * third one client-side, so a nameless user saw "Guest", "Your account" and
 * "Femi9 member" on one page. One resolver, one fallback, one initials function.
 */
export default async function DashboardPage() {
  const s = await getSession('femi9')
  // Middleware already guards /dashboard, but the page re-checks so it never
  // renders for an anonymous request (defence in depth) and so it has a concrete
  // user id to load data for. `next` survives the round trip, unlike before.
  if (!s) redirect('/login?next=/dashboard')

  // Cheap three-column probe before the expensive reads: an account that never
  // finished onboarding has no name to greet and no number to deliver to, so it
  // belongs on /welcome. Typing the URL does not bypass this.
  const status = await getProfileStatus('femi9', s.sub)
  if (!status) redirect('/login')
  if (!status.complete) redirect('/welcome?next=/dashboard')

  const [account, cycle, rewardOptions] = await Promise.all([
    getAccountData('femi9', s.sub),
    getCycleData('femi9', s.sub),
    listRewardOptions('femi9'),
  ])
  // The token can be valid while the row is gone (a deleted account with a live
  // cookie). Bounce rather than render a page with no identity.
  if (!account) redirect('/login')

  return (
    <UserDashboard
      {...cycle}
      user={account.user}
      pointsBalance={account.pointsBalance}
      // The comp's Overview tab IS the order history — it is no longer a
      // three-row teaser pointing at /account, so it gets every order.
      orders={account.orders}
      subscriptions={account.subscriptions}
      addresses={account.addresses}
      coupons={account.coupons}
      earnRates={account.earnRates}
      activity={account.activity}
      rewardOptions={rewardOptions}
    />
  )
}

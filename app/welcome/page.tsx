import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@femi9/core/auth'
import { getProfileStatus } from '@femi9/core/services/account'
import { safeNextPath } from '@/lib/safe-next'
import { WelcomeFlow } from './WelcomeFlow'

// Reads the session cookie and the user's own row, so it must render per request.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Complete your profile - Femi9',
  robots: { index: false, follow: false },
}

/**
 * /welcome — the onboarding step that finally captures a name and the contact
 * channel signup did not collect.
 *
 * Both signup paths mint a session BEFORE they know who the customer is: phone
 * OTP writes { phone, role } and the magic link writes { email, emailVerified,
 * role }. This screen closes that gap, and the /account and /dashboard pages
 * redirect here while the profile is incomplete, so it cannot be skipped by
 * typing a URL.
 *
 * The gate is resolved on the server so a completed customer never sees a flash
 * of the form: middleware guarantees a session, this page guarantees the step is
 * still needed. Which FIELDS render is driven entirely by `missing` — there is
 * no per-provider branch anywhere in the flow.
 */
export default async function WelcomePage(props: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const searchParams = await props.searchParams
  const next = resolveNext(typeof searchParams?.next === 'string' ? searchParams.next : null)

  const session = await getSession('femi9')
  // Middleware already bounced an anonymous visitor; this re-check runs in the
  // Node runtime and covers a cookie that expired between the two.
  if (!session) redirect('/login?next=%2Fdashboard')

  const status = await getProfileStatus('femi9', session.sub)
  if (!status) redirect('/login')
  // A completed customer can never see this screen again.
  if (status.complete) redirect(next ?? '/dashboard')

  return <WelcomeFlow initialMissing={status.missing} next={next} />
}

/**
 * The shared open-redirect guard, plus the two loop guards the sign-in chain
 * needs: `/welcome` is rejected against itself because forwarding here would
 * cycle, and `/login` because bouncing a completed customer back to sign-in
 * reads as a bug.
 *
 * Returns null rather than a fallback so the caller can distinguish "no target
 * was asked for" from "the default target".
 */
function resolveNext(raw: string | null): string | null {
  const safe = safeNextPath(raw, '')
  if (!safe) return null
  if (safe === '/login' || safe.startsWith('/login/') || safe.startsWith('/login?')) return null
  if (safe === '/welcome' || safe.startsWith('/welcome/') || safe.startsWith('/welcome?')) return null
  return safe
}

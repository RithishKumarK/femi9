import { handle, ok } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { prisma } from '@/lib/db'
import { toAccountUser } from '@femi9/core/services/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — the signed-in customer plus a profile-completeness report,
 * or `{ user: null }`. Re-reads the User by the session subject so everything
 * reflects the DB, not the (possibly stale) JWT claims. Always 200 so the client
 * can branch on `user` without treating "logged out" as an error.
 *
 * `/welcome` is data-driven off `profile.missing`, so this is the endpoint that
 * decides which onboarding fields a shopper is shown — it must never report a
 * placeholder as a real value. The legacy { id, name, phone, email } keys are
 * preserved so existing callers (Nav) keep working unchanged.
 */
export async function GET() {
  return handle(async () => {
    const empty = { user: null, profile: { complete: false, missing: [] as string[] } }

    const session = await getSession('femi9')
    if (!session) return ok(empty)

    const row = await prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        phone: true,
        phoneVerified: true,
        image: true,
        createdAt: true,
        role: true,
      },
    })
    // A valid token whose user row is gone is the same thing as signed out.
    if (!row) return ok(empty)

    const view = toAccountUser(row)
    return ok({
      user: {
        id: view.id,
        name: view.name,
        displayName: view.displayName,
        initials: view.initials,
        email: view.email,
        emailVerified: view.emailVerified,
        phone: view.phone,
        phoneVerified: view.phoneVerified,
        image: view.image,
        role: row.role,
      },
      profile: { complete: view.profileComplete, missing: view.missing },
    })
  })
}

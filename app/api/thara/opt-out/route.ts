import { NextResponse } from 'next/server'
import { handle, unauthorized, notFound } from '@femi9/core/api'
import { getSession } from '@femi9/core/auth'
import { optOutUser } from '@femi9/core/services/thara'
import { isTharaEnabled } from '@femi9/core/thara/feature'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return handle(async () => {
    if (!isTharaEnabled()) return notFound()
    const session = await getSession('femi9')
    if (!session) return unauthorized()
    await optOutUser('femi9', session.sub)
    return new NextResponse(null, { status: 204 })
  })
}

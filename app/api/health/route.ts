import { ok, handle } from '@femi9/core/api'
import { prisma } from '@/lib/db'
import { productionReadinessReport } from '@femi9/core/production-readiness'

// A health probe must reflect live state, so opt out of static/route caching.
export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    // A lightweight query proves the DB connection; failure downgrades to degraded
    // rather than 500 so uptime monitors still get a structured answer.
    let db = false
    try {
      await prisma.product.count()
      db = true
    } catch (err) {
      console.error('[health] db check failed', err)
    }

    // Only `blocking` gates the probe. `warnings` name features that are switched
    // off for want of a secret (Google sign-in, the Resend webhook, cron auth);
    // they are reported so an operator can see them, but they must not pull the
    // task out of the load balancer and stall the ECS deployment.
    const { blocking: configurationIssues, warnings } = productionReadinessReport()
    const ready = db && configurationIssues.length === 0

    // Timestamp is computed per-request; a module-level value would freeze at build.
    return ok(
      {
        status: ready ? 'ok' : 'degraded',
        db,
        configuration: configurationIssues.length === 0,
        ...(configurationIssues.length ? { missingOrInvalid: configurationIssues } : {}),
        ...(warnings.length ? { warnings } : {}),
        time: new Date().toISOString(),
      },
      // Readiness must fail closed. The ALB matches HTTP 200; returning 200
      // while the DB is unreachable kept a broken task in the target group.
      { status: ready ? 200 : 503 },
    )
  })
}

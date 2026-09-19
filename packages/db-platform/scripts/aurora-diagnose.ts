/**
 * Aurora diagnostic — READ-ONLY.
 *
 * Runs inside the admin container as a one-off ECS task (aws ecs run-task
 * with the CMD overridden). Prints, to stdout / CloudWatch:
 *
 *   • migration history for each of the three schemas (femi9, lumi9, platform)
 *   • whether the recently-added columns exist (Review.verifiedOverride,
 *     BlogPost.bodyHtml)
 *   • blog-post inventory: how many rows in each brand schema, whether the
 *     two "First Period" posts exist, and how much body[] content each has
 *
 * No writes. No secrets echoed. Meant to be piped into a paste back to the
 * developer running the task.
 *
 * Invocation (from your laptop, admin CLI role assumed):
 *
 *   aws ecs run-task \
 *     --cluster <cluster> \
 *     --task-definition <admin-task-def>:<rev> \
 *     --launch-type FARGATE \
 *     --network-configuration "..." \
 *     --overrides '{
 *       "containerOverrides": [{
 *         "name": "admin",
 *         "command": ["npx","tsx","packages/db-platform/scripts/aurora-diagnose.ts"]
 *       }]
 *     }'
 *
 * Then read the log stream under /aws/ecs/<...>/admin.
 */
import { PrismaClient } from '@prisma/client'

interface SchemaTarget {
  label: string
  url: string
}

const TARGETS: SchemaTarget[] = [
  { label: 'FEMI9    ', url: process.env.DATABASE_URL_FEMI9 || process.env.DATABASE_URL || '' },
  { label: 'LUMI9    ', url: process.env.DATABASE_URL_LUMI9 || '' },
  { label: 'PLATFORM ', url: process.env.DATABASE_URL_PLATFORM || '' },
]

function header(s: string) {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  ' + s)
  console.log('══════════════════════════════════════════════════════')
}

async function migrationHistory(db: PrismaClient) {
  try {
    const rows = await db.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      `SELECT migration_name, finished_at
         FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
        ORDER BY migration_name DESC
        LIMIT 15`,
    )
    console.log(`  Recent migrations (${rows.length}):`)
    for (const r of rows) {
      const stamp = r.finished_at ? r.finished_at.toISOString().slice(0, 10) : '(pending)'
      console.log(`    ✓ ${r.migration_name}  ·  ${stamp}`)
    }
  } catch (e) {
    console.log('  (migration table unreadable — schema may be uninitialised): ' + (e instanceof Error ? e.message.slice(0, 120) : ''))
  }
}

async function schemaChecks(db: PrismaClient) {
  const checks: Array<[string, string, string]> = [
    ['Review.verifiedOverride', 'Review', 'verifiedOverride'],
    ['BlogPost.bodyHtml       ', 'BlogPost', 'bodyHtml'],
    ['BlogPost.metaTitle      ', 'BlogPost', 'metaTitle'],
    ['BlogPost.keywords       ', 'BlogPost', 'keywords'],
  ]
  console.log('  Column presence:')
  for (const [label, table, column] of checks) {
    try {
      const rows = await db.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
        table,
        column,
      )
      console.log(`    ${rows.length > 0 ? '✓' : '✗'} ${label}  ${rows.length > 0 ? '' : '(MISSING)'}`)
    } catch (e) {
      console.log(`    ? ${label}  (query error)`)
    }
  }
}

async function blogInventory(db: PrismaClient) {
  try {
    const [{ total }] = await db.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*)::bigint AS total FROM "BlogPost"`,
    )
    console.log(`  BlogPost rows total: ${total}`)

    const targeted = await db.$queryRawUnsafe<{
      slug: string
      title: string
      body_blocks: number | null
      body_chars: number
      has_body_html: boolean | null
    }[]>(
      `SELECT slug, title,
              array_length(body, 1) AS body_blocks,
              COALESCE(length(array_to_string(body,'')),0)::int AS body_chars,
              CASE
                WHEN column_bodyhtml.exists THEN ("bodyHtml" IS NOT NULL)
                ELSE NULL
              END AS has_body_html
         FROM "BlogPost",
              LATERAL (SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'BlogPost' AND column_name = 'bodyHtml'
              ) AS exists) AS column_bodyhtml
        WHERE slug IN ('first-period-experience-india','first-period-guide-menstrual-hygiene-tips')
           OR title ILIKE '%first period%' OR title ILIKE '%nobody told me%'
        ORDER BY "publishedAt" DESC NULLS LAST
        LIMIT 8`,
    )
    if (targeted.length === 0) {
      console.log('  No matching "first period" posts.')
    } else {
      console.log(`  Matching posts (${targeted.length}):`)
      for (const r of targeted) {
        const html = r.has_body_html === null ? 'n/a' : r.has_body_html ? 'set' : 'NULL'
        console.log(`    • ${r.slug}  ·  body: ${r.body_blocks ?? 0} blocks / ${r.body_chars} chars  ·  bodyHtml: ${html}`)
      }
    }
  } catch (e) {
    console.log('  BlogPost inventory error: ' + (e instanceof Error ? e.message.slice(0, 140) : ''))
  }

  // Also list EVERY blog post's shape — the user reports a post looks empty
  // in the editor but not on the storefront, so a full row list per schema
  // tells us at a glance which posts have body[] vs bodyHtml and by how much.
  try {
    const rows = await db.$queryRawUnsafe<{
      slug: string
      title: string
      body_blocks: number | null
      body_chars: number
      has_body_html: boolean | null
      html_chars: number | null
    }[]>(
      `SELECT slug, title,
              array_length(body, 1) AS body_blocks,
              COALESCE(length(array_to_string(body,'')),0)::int AS body_chars,
              CASE
                WHEN column_bodyhtml.exists THEN ("bodyHtml" IS NOT NULL)
                ELSE NULL
              END AS has_body_html,
              CASE
                WHEN column_bodyhtml.exists THEN length("bodyHtml")
                ELSE NULL
              END AS html_chars
         FROM "BlogPost",
              LATERAL (SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'BlogPost' AND column_name = 'bodyHtml'
              ) AS exists) AS column_bodyhtml
        ORDER BY "publishedAt" DESC NULLS LAST`,
    )
    console.log(`\n  All BlogPost rows (${rows.length}):`)
    for (const r of rows) {
      const html = r.has_body_html === null ? 'n/a' : r.has_body_html ? `${r.html_chars ?? 0}c` : 'null'
      console.log(`    • ${r.slug.padEnd(45)}  body=${(r.body_blocks ?? 0).toString().padStart(2)}b/${(r.body_chars ?? 0).toString().padStart(5)}c  bodyHtml=${html}`)
      console.log(`      title: ${r.title.slice(0, 100)}`)
    }
  } catch (e) {
    console.log('  full listing error: ' + (e instanceof Error ? e.message.slice(0, 140) : ''))
  }
}

async function main() {
  for (const t of TARGETS) {
    header(`AURORA ${t.label.trim()}`)
    if (!t.url) {
      console.log(`  (no URL in env — skipped)`)
      continue
    }
    const db = new PrismaClient({ datasourceUrl: t.url })
    try {
      await migrationHistory(db)
      await schemaChecks(db)
      await blogInventory(db)
    } finally {
      await db.$disconnect()
    }
  }
  console.log('\n(done — nothing written)')
}

main().catch((err) => {
  console.error('aurora-diagnose failed:', err)
  process.exit(1)
})

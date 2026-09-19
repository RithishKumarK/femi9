/**
 * Create or update an admin, and grant them a brand role.
 *
 * There is no self-service sign-up for the console and there should not be —
 * this script is how an account comes into existence.
 *
 *   DATABASE_URL_PLATFORM=... npx tsx scripts/create-admin.ts \
 *     --email priya@company.com --name "Priya" --brand femi9 --role owner
 *
 * The password is read from ADMIN_SEED_PASSWORD so it never lands in shell
 * history or a process listing. Re-running for the same email updates the name
 * and adds the brand role, so it is safe to use to grant a second brand.
 */
import { platformDb, disconnectPlatform } from '../src/index'
// The pure module, not the server-only re-export: this is a CLI.
import { hashPassword } from '../../core/src/password-hash'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const email = arg('email')?.trim().toLowerCase()
  const name = arg('name') ?? email
  const brand = arg('brand')
  const role = (arg('role') ?? 'super_admin') as
    | 'owner'
    | 'manager'
    | 'support'
    | 'readonly'
    | 'super_admin'
    | 'finance'
    | 'orders_manager'
    | 'content_manager'
  const VALID_ROLES = new Set([
    'owner', 'manager', 'support', 'readonly',
    'super_admin', 'finance', 'orders_manager', 'content_manager',
  ])
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Unknown role: ${role}. Try super_admin | finance | orders_manager | content_manager | manager | support | readonly.`)
  }
  const password = process.env.ADMIN_SEED_PASSWORD

  if (!email || !brand) {
    throw new Error('Usage: --email <email> --brand <femi9|lumi9> [--name ..] [--role ..]')
  }
  if (brand !== 'femi9' && brand !== 'lumi9') throw new Error(`Unknown brand: ${brand}`)
  if (!password || password.length < 12) {
    throw new Error('Set ADMIN_SEED_PASSWORD to at least 12 characters.')
  }

  const db = platformDb()
  const passwordHash = await hashPassword(password)

  const admin = await db.adminUser.upsert({
    where: { email },
    // An existing account keeps its password unless this is a fresh create —
    // granting someone a second brand must not silently reset their password.
    update: { name: name!, active: true },
    create: { email, name: name!, passwordHash },
  })

  await db.adminBrandRole.upsert({
    where: { adminUserId_brand: { adminUserId: admin.id, brand } },
    update: { role },
    create: { adminUserId: admin.id, brand, role },
  })

  const roles = await db.adminBrandRole.findMany({ where: { adminUserId: admin.id } })
  console.log(`${admin.email} -> ${roles.map((r) => `${r.brand}:${r.role}`).join(', ')}`)
  await disconnectPlatform()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await disconnectPlatform()
  process.exit(1)
})

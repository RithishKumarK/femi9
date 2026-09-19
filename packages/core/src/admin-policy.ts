import type { AdminRole } from '@femi9/db-platform'
import { ADMIN_MODULES, type AdminModule } from './brands'

/**
 * Per-module authorisation policy.
 *
 * The linear `owner > manager > support > readonly` tier still exists — it
 * decides how much a role can DO inside a module it has access to. Whether a
 * role has access to a module at all is decided HERE, in the policy map.
 *
 * A cell of `null` means "this role does not see this module": the console
 * `notFound()`s the page and the API answers 403. The nav renders only the
 * modules whose cell is non-null for the current role.
 *
 * Ranks below tier come from admin-session.ts' RANK table:
 *   owner  = 3  full (settings, users, dangerous ops)
 *   manager = 2  writes, refunds, publishes
 *   support = 1  ordinary writes; no destructive ops
 *   readonly = 0  reads only
 *
 * `super_admin` and `owner` are BOTH full-access on everything — `owner` is the
 * legacy name; `super_admin` is the explicit one. They map identically.
 *
 * Extending: add a new role to the enum + a new row here. If a module row is
 * missing for a legacy role (owner/manager/support/readonly), the default is
 * that role's own tier — so the linear model still works for those four.
 */

type Tier = 'owner' | 'manager' | 'support' | 'readonly'

/** Every module gets `tier`. Explicit `null` means "no access". */
type PolicyRow = Partial<Record<AdminModule, Tier | null>>

/** Utility: give this role the same tier across every module. */
function allModules(tier: Tier): PolicyRow {
  const row: PolicyRow = {}
  for (const m of ADMIN_MODULES) row[m] = tier
  return row
}

const POLICY: Record<AdminRole, PolicyRow> = {
  // ─── Legacy tiered roles (backward compatible) ───────────────────────────
  owner: allModules('owner'),
  manager: allModules('manager'),
  support: allModules('support'),
  readonly: allModules('readonly'),

  // ─── Super admin: identical to owner, explicit name. `team` (admin user
  //     management) is opened for both super_admin and owner via allModules. ──
  super_admin: allModules('owner'),

  // ─── Finance: money, pricing and payouts. Read-only elsewhere in the
  //     money path so a finance person can reconcile without editing. ──────
  finance: {
    dashboard: 'readonly',
    orders: 'readonly',
    subscriptions: 'readonly',
    customers: 'readonly',
    pricing: 'manager',
    coupons: 'manager',
    affiliates: 'manager',
    thara: 'readonly',
    // Everything else omitted → no access (module hidden from nav, 404/403)
  },

  // ─── Orders & inventory: parcels-out. Refund included because a cancel
  //     path on a paid order that never gets refunded is a books mismatch. ─
  orders_manager: {
    dashboard: 'readonly',
    orders: 'manager', // status, ship, cancel, refund
    subscriptions: 'manager',
    inventory: 'manager',
    catalog: 'readonly', // see product cards to identify what's in a box
    customers: 'readonly',
  },

  // ─── SEO / review / blog / community: content and moderation. Settings
  //     is read-only so they can see the site config but not change it. ────
  content_manager: {
    dashboard: 'readonly',
    content: 'manager',
    reviews: 'manager', // moderate + admin-authored reviews
    community: 'manager', // wall moderation
    parenting: 'manager', // Lumi9 content
    settings: 'readonly',
  },
}

/** True when the role sees this module at all (nav + page + API). */
export function roleHasModule(role: AdminRole, moduleName: AdminModule): boolean {
  const tier = POLICY[role]?.[moduleName]
  return tier !== undefined && tier !== null
}

/** The effective tier a role has inside a module. `null` when no access. */
export function effectiveTier(
  role: AdminRole,
  moduleName: AdminModule,
): Tier | null {
  const tier = POLICY[role]?.[moduleName]
  return tier ?? null
}

/** All modules this role can see, in the fixed ADMIN_MODULES display order. */
export function modulesForRole(role: AdminRole): AdminModule[] {
  return ADMIN_MODULES.filter((m) => roleHasModule(role, m))
}

/** True when a role holds the required tier on a specific module. */
export function roleCanOnModule(
  role: AdminRole,
  moduleName: AdminModule,
  required: Tier,
): boolean {
  const RANK: Record<Tier, number> = { owner: 3, manager: 2, support: 1, readonly: 0 }
  const tier = effectiveTier(role, moduleName)
  if (tier === null) return false
  return RANK[tier] >= RANK[required]
}

/**
 * Who is allowed to manage other admins (invite/edit/deactivate).
 * ONLY super_admin + owner — the "Team" page 404s for anyone else, per the
 * decision recorded in docs/ROLES.md.
 */
export function canManageAdmins(role: AdminRole): boolean {
  return role === 'super_admin' || role === 'owner'
}

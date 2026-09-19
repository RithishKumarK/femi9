import 'server-only'
import { z } from 'zod'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Admin coupon service. Coupons are simple discount codes shoppers type at
 * checkout — either `flat` (rupees off) or `pct` (a percentage). Two invariants
 * drive the design:
 *  - `code` is stored UPPERCASE and deduped on that value, so "save10" and
 *    "SAVE10" can never both exist and collide when matched at checkout.
 *  - `usedCount` is system-owned (bumped when an order redeems the coupon) and is
 *    therefore never settable through this admin surface — only shown.
 */

// ─────────────────────────── Validation (zod) ───────────────────────────
// z.coerce so the JSON payload from an <input> ("225") is accepted alongside 225.

// Blank optional numeric/date fields arrive as '' from the form; normalise to
// null before coercion so an empty box means "unset", not 0 / Invalid Date.
const emptyToNull = (v: unknown) => (v === '' || v == null ? null : v)

export const CouponInputSchema = z
  .object({
    // Uppercased here so the whole stack (dedupe + storage) sees one canonical form.
    code: z
      .string()
      .trim()
      .min(1, 'Code is required')
      .max(40, 'Code is too long')
      .transform((s) => s.toUpperCase()),
    type: z.enum(['flat', 'pct']),
    // flat → rupees off; pct → a percentage (upper-bounded by the refine below).
    value: z.coerce.number().int('Whole numbers only').min(1, 'Value must be at least 1'),
    minOrder: z.coerce.number().int().min(0, 'Min order can’t be negative').default(0),
    // null = unlimited redemptions.
    maxUses: z.preprocess(emptyToNull, z.coerce.number().int().min(1, 'Must be at least 1').nullable()).optional(),
    // null = never expires. Accepts a yyyy-mm-dd (date input) or an ISO string.
    expiresAt: z.preprocess(emptyToNull, z.coerce.date().nullable()).optional(),
    active: z.boolean().default(true),
  })
  // A percentage over 100 is nonsensical — keep pct in 1..100.
  .refine((v) => v.type !== 'pct' || v.value <= 100, {
    message: 'A percentage discount can’t exceed 100',
    path: ['value'],
  })

export type CouponInput = z.infer<typeof CouponInputSchema>

/**
 * Thrown when a code collides with an existing coupon (on create, or on rename
 * during update). The route maps this to a friendly 400; the DB @unique index on
 * `code` is the real backstop against a race between the check and the write.
 */
export class CouponCodeTakenError extends Error {
  constructor(code: string) {
    super(`Coupon code “${code}” is already in use`)
    this.name = 'CouponCodeTakenError'
  }
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** Every coupon, newest first — the admin list shows all (active + inactive). */
export async function listCoupons(brand: Brand) {
  const prisma = dbFor(brand)
  try {
    return await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } })
  } catch {
    return []
  }
}

// ─────────────────────────────── Writes ─────────────────────────────────

/** Reject a code that already belongs to another coupon (uniqueness guard). */
async function assertCodeFree(brand: Brand, code: string, excludeId?: string) {
  const prisma = dbFor(brand)
  const clash = await prisma.coupon.findFirst({
    where: { code, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new CouponCodeTakenError(code)
}

export async function createCoupon(brand: Brand, input: CouponInput) {
  const prisma = dbFor(brand)
  // input.code is already uppercased by the schema transform.
  await assertCodeFree(brand, input.code)

  return prisma.coupon.create({
    data: {
      code: input.code,
      type: input.type,
      value: input.value,
      minOrder: input.minOrder,
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
      active: input.active,
    },
  })
}

export async function updateCoupon(brand: Brand, id: string, input: CouponInput) {
  const prisma = dbFor(brand)
  await assertCodeFree(brand, input.code, id)

  // usedCount is intentionally left untouched — it belongs to the redemption flow.
  return prisma.coupon.update({
    where: { id },
    data: {
      code: input.code,
      type: input.type,
      value: input.value,
      minOrder: input.minOrder,
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
      active: input.active,
    },
  })
}

/** Flip active on/off. Returns null when the coupon is gone so the route 404s. */
export async function toggleActive(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  const current = await prisma.coupon.findUnique({ where: { id }, select: { active: true } })
  if (!current) return null
  return prisma.coupon.update({ where: { id }, data: { active: !current.active } })
}

export async function deleteCoupon(brand: Brand, id: string) {
  const prisma = dbFor(brand)
  return prisma.coupon.delete({ where: { id }, select: { id: true } })
}

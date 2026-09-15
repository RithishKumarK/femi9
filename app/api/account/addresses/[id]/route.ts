import { z } from 'zod'
import { badRequest, handle, notFound, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { deleteAddress, updateAddress } from '@femi9/core/services/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Field rules mirror the POST schema exactly, so the same inline errors render
 * whether the customer is adding an address or editing one. Every message is
 * written for a person to read — `details.fieldErrors` is what the form binds.
 */
const PatchSchema = z.object({
  label: z.string().trim().min(1, 'Give this address a label').max(40).optional(),
  name: z.string().trim().min(2, 'Enter the recipient name').max(120).optional(),
  line: z.string().trim().min(3, 'Enter the flat, street and area').max(300).optional(),
  city: z.string().trim().min(2, 'Enter the city').max(120).optional(),
  state: z.string().trim().max(120).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter a 6-digit pincode')
    .optional()
    .or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter a 10-digit mobile number')
    .optional()
    .or(z.literal('')),
  isPrimary: z.boolean().optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('femi9')
    if (!user) return unauthorized()
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Check the address fields.', parsed.error.flatten())
    const address = await updateAddress('femi9', user.sub, (await ctx.params).id, parsed.data)
    if (!address) return notFound('Address not found')
    return ok({ ok: true })
  })
}

/**
 * DELETE always succeeds for an address the customer owns. It used to 400 with
 * "an address used by an order cannot be deleted", which made every address a
 * shopper had ever ordered to permanently undeletable — and checkout minted a
 * fresh one per order, so the book filled with identical undeletable cards.
 * The service archives order-linked rows instead (the order's FK survives) and
 * hard-deletes the rest; both are a 200 here.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('femi9')
    if (!user) return unauthorized()
    const result = await deleteAddress('femi9', user.sub, (await ctx.params).id)
    if (result === 'missing') return notFound('Address not found')
    return ok({ ok: true })
  })
}

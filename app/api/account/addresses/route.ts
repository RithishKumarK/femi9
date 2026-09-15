import { z } from 'zod'
import { badRequest, created, handle, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { createAddress } from '@femi9/core/services/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every message here is written for a person, because the form renders them
 * inline from `details.fieldErrors` rather than dropping the customer's six
 * answers on the floor the way the old prompt() chain did. `label` carries the
 * customer's real choice (Home / Work / Other / free text), not a hardcoded one.
 */
const AddressSchema = z.object({
  label: z.string().trim().min(1, 'Give this address a label').max(40),
  name: z.string().trim().min(2, 'Enter the recipient name').max(120),
  line: z.string().trim().min(3, 'Enter the flat, street and area').max(300),
  city: z.string().trim().min(2, 'Enter the city').max(120),
  state: z.string().trim().max(120).optional().default(''),
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

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser('femi9')
    if (!user) return unauthorized()
    const parsed = AddressSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Check the address fields.', parsed.error.flatten())
    const address = await createAddress('femi9', user.sub, parsed.data)
    return created({ id: address.id })
  })
}

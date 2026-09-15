import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, handle, ok } from '@femi9/core/api'
import { getGuestToken } from '@/lib/session'
import { EMPTY_CART, removeItem, setQty } from '@femi9/core/services/cart'

type Ctx = { params: Promise<{ variantId: string }> }

// qty <= 0 is a valid "remove this line" signal, so no positive() constraint.
const QtySchema = z.object({ qty: z.number().int().max(99) })

/** PATCH /api/cart/items/:variantId — set an exact quantity (0 removes the line). */
export async function PATCH(req: NextRequest, props: Ctx) {
  const params = await props.params;
  return handle(async () => {
    const token = await getGuestToken()
    if (!token) return ok(EMPTY_CART) // no cart yet → nothing to update

    const raw = await req.json().catch(() => null)
    const parsed = QtySchema.safeParse(raw)
    if (!parsed.success) return badRequest('Invalid request', parsed.error.flatten())

    return ok(await setQty('femi9', token, params.variantId, parsed.data.qty))
  })
}

/** DELETE /api/cart/items/:variantId — drop the line from the cart. */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const params = await props.params;
  return handle(async () => {
    const token = await getGuestToken()
    if (!token) return ok(EMPTY_CART)

    return ok(await removeItem('femi9', token, params.variantId))
  })
}

import 'server-only'
import { dbFor, type Brand } from '@femi9/db'

/**
 * The one-time, support-granted address correction on a placed order.
 *
 * ── Why this is not simply "let her edit the address" ────────────────────────
 * The address on an order is what the parcel is labelled from. Once a courier
 * has it, a change on our side is a lie: the box is already going somewhere
 * else, and showing her a saved confirmation would be worse than refusing.
 * So the default is closed, and support opens a single correction per order.
 *
 * The two cases it was written for are both real:
 *  - She has moved, or typed the wrong flat, between placing and dispatch.
 *  - A subscription renewal was charged with NO address at all.
 *    `recordSubscriptionCharge` writes `addressId: address?.id ?? null` — it
 *    ships to the customer's primary saved address, and nullable keeps the row
 *    valid when she has never saved one. Order LM-00014 was created, charged
 *    and marked paid with nowhere to send it. Nothing failed; the money
 *    arrived. Before this, fixing it meant an admin typing into the database.
 *
 * ── Why a NEW Address row, never an edit of the old one ──────────────────────
 * `Address` rows are SHARED. `placeOrder` reuses an identical existing row
 * rather than minting a duplicate per order, and a subscription renewal points
 * at whatever her primary address is. So updating the row in place would
 * silently rewrite the delivery address of every OTHER order pointing at it,
 * and her address book with it. A correction therefore resolves a row the same
 * way checkout does — reuse an exact match, otherwise create — and repoints
 * `order.addressId`. The old row is left untouched, which also means the
 * original address is still readable for any order that kept it.
 *
 * ── Why the grant is consumed by an `updateMany` ─────────────────────────────
 * "Only one time" has to be enforced where the write happens, not by a check
 * before it. Two tabs, or a double-tapped Save, both read `usedAt: null` and
 * both proceed — and the second one silently spends a grant support did not
 * give. The consume is an `updateMany` whose `where` still names
 * `addressEditUsedAt: null`, so exactly one of them can match; the loser is
 * told the window has closed, which is true. `updateOrderStatus` guards a
 * status flip the same way and for the same reason.
 */

/**
 * Statuses where changing the address can still reach the parcel.
 *
 * `shipped` and `delivered` are out because the box has gone. `cancelled` and
 * `refunded` are out because there is no parcel to redirect — and a customer
 * editing the address of a refunded order would reasonably conclude it was
 * being sent after all.
 */
export const ADDRESS_EDITABLE_STATUSES = ['pending', 'paid', 'processing'] as const

/** Why the correction window is not open. `null` when it is. */
export type AddressEditClosedReason = 'not-granted' | 'already-used' | 'too-late'

export interface AddressEditState {
  /** Whether the customer may edit the address right now. */
  open: boolean
  /** Populated exactly when `open` is false. */
  reason: AddressEditClosedReason | null
  /** When support opened the window, if they have. */
  grantedAt: Date | null
  /** When she saved, if she has. Non-null closes it for good. */
  usedAt: Date | null
}

export interface OrderAddressInput {
  name: string
  line: string
  city: string
  state: string
  pincode: string
  phone?: string | null
  label?: string | null
}

/** The window is only open when support opened it, she has not used it, and the
 *  order has not been dispatched. All three, every time it is asked. */
export function addressEditState(order: {
  status: string
  addressEditGrantedAt: Date | null
  addressEditUsedAt: Date | null
}): AddressEditState {
  const base = { grantedAt: order.addressEditGrantedAt, usedAt: order.addressEditUsedAt }
  if (order.addressEditUsedAt) return { open: false, reason: 'already-used', ...base }
  if (!order.addressEditGrantedAt) return { open: false, reason: 'not-granted', ...base }
  if (!(ADDRESS_EDITABLE_STATUSES as readonly string[]).includes(order.status)) {
    // Granted, unused, but the order moved on since. The grant is not revoked —
    // support may have opened it seconds before dispatch — it simply no longer
    // applies, and saying "too late" is more honest than "not allowed".
    return { open: false, reason: 'too-late', ...base }
  }
  return { open: true, reason: null, ...base }
}

/** Thrown when the customer's save arrives after the window shut. Carries the
 *  reason so the route can turn it into a sentence rather than a 400. */
export class AddressEditClosedError extends Error {
  constructor(readonly reason: AddressEditClosedReason) {
    super(
      reason === 'already-used'
        ? 'This address has already been updated once. Please contact support if it still needs changing.'
        : reason === 'too-late'
          ? 'This order has already been dispatched, so its address can no longer be changed.'
          : 'Address changes are not open for this order. Please contact support.',
    )
    this.name = 'AddressEditClosedError'
  }
}

/**
 * The correction window for one of THIS customer's orders.
 *
 * Scoped by `userId` as well as `orderNo`, so a guessed order number belongs to
 * nobody: an order that is not hers reads as absent rather than as forbidden.
 */
export async function getOrderAddressEditState(
  brand: Brand,
  orderNo: string,
  userId: string,
): Promise<AddressEditState | null> {
  const prisma = dbFor(brand)
  const order = await prisma.order.findFirst({
    where: { orderNo, userId },
    select: { status: true, addressEditGrantedAt: true, addressEditUsedAt: true },
  })
  if (!order) return null
  return addressEditState(order)
}

export interface UpdatedOrderAddress {
  orderNo: string
  address: {
    name: string
    line: string
    city: string
    state: string | null
    pincode: string | null
    phone: string | null
  }
}

/**
 * Spend the grant: write a new address onto the order and close the window.
 *
 * Returns the address as stored. Throws `AddressEditClosedError` when the
 * window is not open, and returns `null` when the order is not this customer's.
 */
export async function updateOrderAddress(
  brand: Brand,
  orderNo: string,
  userId: string,
  input: OrderAddressInput,
): Promise<UpdatedOrderAddress | null> {
  const prisma = dbFor(brand)

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { orderNo, userId },
      select: { id: true, status: true, addressEditGrantedAt: true, addressEditUsedAt: true },
    })
    if (!order) return null

    // Read the state first so the customer gets a reason rather than a generic
    // failure. It is checked AGAIN by the consume below, which is what actually
    // enforces it — this read is for the message, not for the rule.
    const state = addressEditState(order)
    if (!state.open) throw new AddressEditClosedError(state.reason!)

    const name = input.name.trim()
    const line = input.line.trim()
    const city = input.city.trim()
    const state_ = input.state.trim()
    const pincode = input.pincode.trim()
    const phone = input.phone?.trim() || null
    const label = input.label?.trim().slice(0, 40) || 'Home'

    // Resolve the row exactly as checkout does: reuse an identical one so a
    // correction back to an address she already has does not leave a duplicate
    // card in her book, otherwise create. Never an update — see the note above.
    const existing = await tx.address.findFirst({
      where: { userId, archivedAt: null, line, city, pincode, phone },
      select: { id: true },
    })
    const addressCount = await tx.address.count({ where: { userId, archivedAt: null } })
    const address =
      existing ??
      (await tx.address.create({
        data: {
          userId,
          label,
          name,
          line,
          city,
          state: state_,
          pincode,
          phone,
          // Her first address is her primary. This matters for the case this
          // was written for: a subscriber with no address at all gets one, and
          // `recordSubscriptionCharge` reads the primary — so the NEXT renewal
          // ships correctly without anyone touching it again.
          isPrimary: addressCount === 0,
        },
        select: { id: true },
      }))

    // The consume. `addressEditUsedAt: null` is still in the `where`, so a
    // concurrent second save matches nothing and is refused below.
    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        addressEditGrantedAt: { not: null },
        addressEditUsedAt: null,
        status: { in: [...ADDRESS_EDITABLE_STATUSES] },
      },
      data: { addressId: address.id, addressEditUsedAt: new Date() },
    })
    if (claimed.count !== 1) throw new AddressEditClosedError('already-used')

    return {
      orderNo,
      address: { name, line, city, state: state_, pincode, phone },
    }
  })
}

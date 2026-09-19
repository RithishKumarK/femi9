/**
 * @femi9/core — the shared backend for both brands.
 *
 * This entry point is deliberately THIN. Import what you need by subpath:
 *
 *   import { requireAdmin }  from '@femi9/core/admin-auth'
 *   import { getOrders }     from '@femi9/core/services/admin/orders'
 *   import { ok, handle }    from '@femi9/core/api'
 *
 * A barrel that re-exported all 59 modules would pull the entire service layer
 * — Razorpay, Prisma, the mail and OTP clients — into any consumer that wanted
 * one helper, and invites import cycles between services.
 *
 * Brand primitives are re-exported here because nearly every caller needs them.
 */
export { dbFor, isBrand, BRANDS, type Brand } from '@femi9/db'

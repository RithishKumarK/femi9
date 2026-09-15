import { z } from 'zod'
import { badRequest, conflict, handle, notFound, ok, unauthorized } from '@femi9/core/api'
import { requireUser } from '@femi9/core/auth'
import { updateProfile } from '@femi9/core/services/account'
import { IdentityConflictError } from '@femi9/core/services/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The profile editor. Used to accept `name` and nothing else, which meant a
 * phone-signup customer was permanently email-less and an email-signup customer
 * permanently phone-less — the split identity behind the invisible orders, the
 * skipped reward emails and the defeated self-referral guard.
 *
 * All three keys are optional individually, but sending none of them is a
 * no-op the client shouldn't be making, so it is a 400.
 */
const ProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(120).optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').optional(),
    // Canonicalised exactly as normalizePhone does (strip non-digits, keep the
    // last 10), so a pasted "+91 98842 30571" compares equal to the stored value
    // instead of being read as a change and bounced to the OTP challenge.
    phone: z
      .string()
      .trim()
      .transform((v) => {
        const digits = v.replace(/\D/g, '')
        return digits.length > 10 ? digits.slice(-10) : digits
      })
      .refine((v) => v.length === 10, 'Enter a valid 10-digit mobile number')
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.email !== undefined || v.phone !== undefined, {
    message: 'Nothing to update.',
  })

export async function PATCH(req: Request) {
  return handle(async () => {
    const session = await requireUser('femi9')
    if (!session) return unauthorized()

    const parsed = ProfileSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return badRequest('Check the details you entered.', parsed.error.flatten())

    try {
      const result = await updateProfile('femi9', session.sub, parsed.data)
      if (result.status === 'not-found') return notFound('User not found')
      if (result.status === 'phone-requires-verification') {
        // A contact channel that reaches a customer's orders is never settable
        // by an unverified PATCH. `next` tells the form where to continue.
        return badRequest('Verify your mobile number to change it.', undefined, {
          code: 'phone_requires_verification',
          field: 'phone',
          next: '/api/account/phone/request',
        })
      }

      const { user } = result
      return ok({
        ok: true,
        profileComplete: user.profileComplete,
        missing: user.missing,
        user: {
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          phone: user.phone,
          phoneVerified: user.phoneVerified,
        },
      })
    } catch (err) {
      if (err instanceof IdentityConflictError) {
        return conflict(err.message, { code: 'identity_conflict', field: err.field })
      }
      throw err
    }
  })
}

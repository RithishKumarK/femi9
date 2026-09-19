import 'server-only'

/**
 * Password hashing for admin accounts, guarded for app code.
 *
 * The implementation lives in `./password-hash`, which carries no `server-only`
 * so the create-admin CLI can use it. This module is the same thing with the
 * marker on, so an accidental import from a client component still fails loudly
 * inside the apps.
 */
export { hashPassword, verifyPassword, needsRehash, fakeVerify } from './password-hash'

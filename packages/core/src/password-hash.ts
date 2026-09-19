import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

// `promisify` resolves to scrypt's THREE-argument overload and drops the options
// parameter, so the cost settings below would not typecheck even though they
// work at runtime. Assert the overload we actually call.
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

/**
 * Password hashing for admin accounts — the pure half.
 *
 * Deliberately free of `server-only`. It is plain `node:crypto` with no
 * request-scoped imports and no secrets of its own, and the CLI that creates
 * the first admin has to be able to import it — `server-only` throws outside a
 * Next server, which made the seed script unrunnable.
 *
 * `./admin-password` re-exports this WITH the marker, so anything inside the
 * apps still cannot pull it into a client bundle by accident.
 *
 * ── Why scrypt and not argon2id ─────────────────────────────────────────────
 * The architecture note said argon2id, which is the stronger recommendation in
 * the abstract. In practice every argon2 binding for Node is a native module,
 * and this image is Alpine/musl built from a workspace root — a prebuilt that
 * silently resolves to glibc, or a build toolchain that has to exist in the
 * deps stage, is a whole class of deploy failure for the one endpoint that must
 * never be down. `node:crypto` scrypt is in the standard library, behaves
 * identically on a Windows dev box and in the container, and is an accepted
 * password KDF (OWASP lists it alongside argon2id). If argon2id is wanted
 * later, the encoded format below carries its own algorithm name, so both can
 * coexist while stored hashes are upgraded on next sign-in.
 *
 * ── Parameters ──────────────────────────────────────────────────────────────
 * N=2^16, r=8, p=1 costs ~64 MB and ~100ms per verify, which is the point: it
 * is what makes an offline attack on a leaked hash expensive. `maxmem` has to
 * be raised explicitly because Node's default ceiling is 32 MB and these
 * parameters exceed it — without it, hashing throws rather than running weak.
 *
 * The parameters are stored IN the hash, so raising them later does not
 * invalidate existing passwords: an old hash still verifies under its own
 * recorded cost, and `needsRehash` reports when to upgrade it.
 */
const ALGORITHM = 'scrypt'
const N = 2 ** 16
const R = 8
const P = 1
const KEY_LEN = 32
const SALT_LEN = 16
const MAXMEM = 128 * 1024 * 1024

/** `scrypt$N$r$p$salt$hash`, both blobs base64. Self-describing on purpose. */
function encode(salt: Buffer, hash: Buffer): string {
  return [ALGORITHM, N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

interface Parsed {
  n: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

function decode(stored: string): Parsed | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return null
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string]
  const parsed = {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  }
  if (!Number.isFinite(parsed.n) || !Number.isFinite(parsed.r) || !Number.isFinite(parsed.p)) return null
  if (!parsed.salt.length || !parsed.hash.length) return null
  return parsed
}

/** Hash a new password with the CURRENT parameters. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  })
  return encode(salt, hash)
}

/**
 * Verify a password against a stored hash, in constant time.
 *
 * Returns false — never throws — for a malformed or empty stored value, so a
 * corrupted row reads as "wrong password" rather than a 500 that tells an
 * attacker the account exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = decode(stored)
  if (!parsed) return false
  try {
    const candidate = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAXMEM,
    })
    // Lengths already match by construction, so this cannot throw on mismatch.
    return timingSafeEqual(candidate, parsed.hash)
  } catch {
    return false
  }
}

/** True when a stored hash used weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = decode(stored)
  if (!parsed) return true
  return parsed.n < N || parsed.r < R || parsed.p < P
}

/**
 * A verify that costs the same as a real one, for when no such admin exists.
 *
 * Without it, a missing account returns in microseconds while a real one takes
 * ~100ms, and that gap enumerates your staff. Callers run this on the
 * not-found path so both branches cost the same.
 */
export async function fakeVerify(): Promise<false> {
  await scrypt('no-such-account', randomBytes(SALT_LEN), KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  })
  return false
}

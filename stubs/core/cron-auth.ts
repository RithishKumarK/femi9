/**
 * CRON_SECRET comparison. Kept real: it is pure string work.
 */

export function cronSecretOk(header: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !header) return false
  return header === secret
}

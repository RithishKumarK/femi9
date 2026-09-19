import 'server-only'
import { Prisma } from '@prisma/client'
import type { PartnerStatus } from '@prisma/client'
import { dbFor, type Brand } from '@femi9/db'

/**
 * Admin partner-CRM service — the pipeline side of the storefront lead capture
 * (services/partner.ts). Every application is a lead the sales team works
 * through: new → contacted → onboarded / rejected, with a free-text notes field
 * for call outcomes.
 *
 * Rows are shaped for the client here (`createdAt` serialised to an ISO string)
 * so the lead table — a client component — can consume them straight from JSON
 * without importing this `server-only` module at runtime.
 */

export type PartnerRow = {
  id: string
  name: string
  phone: string
  city: string
  situation: string | null
  reason: string | null
  status: PartnerStatus
  notes: string | null
  createdAt: string // ISO 8601 — Dates aren't JSON-serialisable to the client.
}

function toRow(a: {
  id: string
  name: string
  phone: string
  city: string
  situation: string | null
  reason: string | null
  status: PartnerStatus
  notes: string | null
  createdAt: Date
}): PartnerRow {
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    city: a.city,
    situation: a.situation,
    reason: a.reason,
    status: a.status,
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  }
}

// ─────────────────────────────── Reads ──────────────────────────────────

/** All leads (optionally filtered by status), newest first. */
export async function listApplications(brand: Brand, {
  status,
}: { status?: PartnerStatus } = {}): Promise<PartnerRow[]> {
  const prisma = dbFor(brand)
  try {
    const rows = await prisma.partnerApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toRow)
  } catch (err) {
    console.error('[listApplications] DB error:', err)
    return []
  }
}

// ─────────────────────────────── Writes ─────────────────────────────────

/**
 * Advance a lead through the pipeline. Returns the reconciled row so the table
 * can update in place, or null when the id no longer exists (P2025 → 404).
 */
export async function updateStatus(brand: Brand, 
  id: string,
  status: PartnerStatus,
): Promise<PartnerRow | null> {
  const prisma = dbFor(brand)
  try {
    const a = await prisma.partnerApplication.update({ where: { id }, data: { status } })
    return toRow(a)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
    throw err
  }
}

/**
 * Save the sales team's notes for a lead (call outcomes etc.). Blank input
 * clears the field. Returns null when the id is gone (P2025 → 404).
 */
export async function addNote(brand: Brand, id: string, notes: string): Promise<PartnerRow | null> {
  const prisma = dbFor(brand)
  try {
    const a = await prisma.partnerApplication.update({
      where: { id },
      data: { notes: notes.trim() || null },
    })
    return toRow(a)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
    throw err
  }
}

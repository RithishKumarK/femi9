/**
 * Encrypted period and symptom logs.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export interface PeriodEntry { id: string; start: string; length: number }

export interface SymptomEntry { id: string; day: string; symptom: string; level: number }

export interface CycleData { periods: PeriodEntry[]; symptoms: SymptomEntry[]; avgCycle: number; avgPeriod: number; consent: boolean }

export class CycleConsentRequiredError extends StubDomainError {}
export class FutureDateError extends StubDomainError {}

export function cycleStorageReady(): boolean {
  // Without CYCLE_DATA_ENCRYPTION_KEY the store must report itself unavailable
  // rather than fall back to writing cycle data in the clear.
  return false
}

export async function deletePeriod(..._args: unknown[]): Promise<never> {
  return unavailable('deletePeriod')
}

export async function deleteSymptom(..._args: unknown[]): Promise<never> {
  return unavailable('deleteSymptom')
}

export async function getCycleData(..._args: unknown[]): Promise<never> {
  return unavailable('getCycleData')
}

export async function logPeriod(..._args: unknown[]): Promise<never> {
  return unavailable('logPeriod')
}

export async function logSymptom(..._args: unknown[]): Promise<never> {
  return unavailable('logSymptom')
}

export async function setCycleConsent(..._args: unknown[]): Promise<never> {
  return unavailable('setCycleConsent')
}

export async function updatePeriod(..._args: unknown[]): Promise<never> {
  return unavailable('updatePeriod')
}

export async function updateSymptom(..._args: unknown[]): Promise<never> {
  return unavailable('updateSymptom')
}

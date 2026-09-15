/**
 * Shopper reviews and helpful votes.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable, StubDomainError } from '../_unavailable'

export class ProductNotFoundError extends StubDomainError {}
export class ReviewNotFoundError extends StubDomainError {}
export class AlreadyVotedError extends StubDomainError {}

export async function submitReview(..._args: unknown[]): Promise<never> {
  return unavailable('submitReview')
}

export async function voteOnReview(..._args: unknown[]): Promise<never> {
  return unavailable('voteOnReview')
}

/**
 * The honest failure mode for every stub that would otherwise need Postgres, a
 * payment gateway, or a messaging provider.
 *
 * Throwing is deliberate. A stub that returned a plausible-looking success for
 * `placeOrder` or `verifyWebhookSignature` would let a page render as though the
 * money path worked, which is the one thing a front-end preview must never
 * suggest.
 */
export class StubUnavailableError extends Error {
  constructor(what: string) {
    super(
      `${what} is not available in this standalone copy: it needs @femi9/core + Postgres, ` +
        `which live in the femi9-platform monorepo. See stubs/README.md.`,
    )
    this.name = 'StubUnavailableError'
  }
}

export function unavailable(what: string): never {
  throw new StubUnavailableError(what)
}

/** Marker base so route handlers' `instanceof` branches still typecheck. */
export class StubDomainError extends Error {
  constructor(message = 'stub') {
    super(message)
    this.name = new.target.name
  }
}

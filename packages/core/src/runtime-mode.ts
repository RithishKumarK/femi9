import 'server-only'

/**
 * Provider mocks are useful for deterministic local/E2E testing, but must never
 * become an authentication or payment bypass in production.
 */
export function mockProvidersAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_MOCK_PROVIDERS === 'true'
}

/** Treat Terraform's initial TODO values exactly like missing configuration. */
export function configuredEnv(name: string): boolean {
  const value = process.env[name]?.trim()
  return Boolean(value && !/^TODO(?:[-_:]|\b)/i.test(value))
}

export class ProviderConfigurationError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured.`)
    this.name = 'ProviderConfigurationError'
  }
}

/**
 * The deploy checklist. It inspects env + database state.
 *
 * Stub: see stubs/README.md. Calls that would need Postgres, a payment
 * gateway or a messaging provider throw rather than fake a success.
 */

import { unavailable } from './_unavailable'

export async function productionReadinessIssues(..._args: unknown[]): Promise<never> {
  return unavailable('productionReadinessIssues')
}

export async function productionReadinessReport(..._args: unknown[]): Promise<never> {
  return unavailable('productionReadinessReport')
}

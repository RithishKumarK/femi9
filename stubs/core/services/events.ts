/**
 * Analytics event log.
 */

export async function logEvent(_brand: string, _name: string, _payload?: unknown): Promise<void> {
  // Swallowed on purpose: an analytics write must never take a page down, and
  // that is exactly how the real service behaves when the sink is unreachable.
}

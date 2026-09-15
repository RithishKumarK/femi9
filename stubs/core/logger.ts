/**
 * Structured logger. Kept real, pointed at the console.
 */

type Fields = Record<string, unknown>

export const logger = {
  info: (msg: string, fields?: Fields) => console.info('[info]', msg, fields ?? ''),
  warn: (msg: string, fields?: Fields) => console.warn('[warn]', msg, fields ?? ''),
  error: (msg: string, fields?: Fields) => console.error('[error]', msg, fields ?? ''),
  debug: (msg: string, fields?: Fields) => console.debug('[debug]', msg, fields ?? ''),
}

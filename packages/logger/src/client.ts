import { type Logger, pino } from 'pino'

import type { LogLevel } from './config'

export interface ClientLoggerOptions {
  readonly level?: LogLevel
}

/** A browser logger for one module; bundlers resolve pino to its browser build. */
export function createLogger(module: string, options: ClientLoggerOptions = {}): Logger {
  return pino({ level: options.level ?? 'info', browser: { asObject: true } }).child({ module })
}

export type { Logger } from 'pino'

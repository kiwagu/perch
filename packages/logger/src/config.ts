import { z } from '@workspace/zod'

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export type LogFormat = 'json' | 'human'

export interface LogConfig {
  readonly level: LogLevel
  readonly format: LogFormat
}

const LogEnvSchema = z.object({
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_FORMAT: z.enum(['json', 'human']).default('json'),
})

/** Parses LOG_LEVEL and LOG_FORMAT once; an unknown value fails loudly at startup. */
export function readLogConfig(env: Readonly<Record<string, string | undefined>>): LogConfig {
  const parsed = LogEnvSchema.parse(env)

  return { level: parsed.LOG_LEVEL, format: parsed.LOG_FORMAT }
}

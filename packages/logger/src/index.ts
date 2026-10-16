import { type Logger, pino } from 'pino'

import { type LogConfig, type LogFormat, type LogLevel, readLogConfig } from './config'

export interface LineSink {
  write(line: string): void
}

export interface LoggerOptions {
  readonly level?: LogLevel
  readonly format?: LogFormat
  readonly destination?: LineSink
}

const LEVEL_NAMES: Readonly<Record<number, string>> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

function formatHuman(line: string): string {
  const {
    level,
    time,
    msg,
    module,
    pid: _pid,
    hostname: _hostname,
    ...rest
  } = JSON.parse(line) as Record<string, unknown>
  const at = new Date(typeof time === 'number' ? time : Date.now())
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''

  return `${clock} ${LEVEL_NAMES[Number(level)] ?? 'LOG'} [${String(module)}] ${String(msg ?? '')}${extra}\n`
}

function humanSink(target: LineSink): LineSink {
  return { write: (line) => target.write(formatHuman(line)) }
}

let defaults: LogConfig | undefined

/** A logger for one module. Level and format come from LOG_LEVEL / LOG_FORMAT unless given. */
export function createLogger(module: string, options: LoggerOptions = {}): Logger {
  defaults ??= readLogConfig(process.env)

  const level = options.level ?? defaults.level
  const format = options.format ?? defaults.format
  const target = options.destination ?? process.stdout
  const sink = format === 'human' ? humanSink(target) : target

  return pino({ level, base: { module } }, sink)
}

export type { Logger } from 'pino'

export { type LogConfig, type LogFormat, type LogLevel, readLogConfig } from './config'

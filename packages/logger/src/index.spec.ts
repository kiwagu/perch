import { describe, expect, it } from 'vitest'

import { createLogger, readLogConfig } from './index'

function capture(): { lines: string[]; write(line: string): void } {
  const lines: string[] = []

  return { lines, write: (line) => lines.push(line) }
}

describe('createLogger', () => {
  it('writes JSON lines bound to the module name', () => {
    const sink = capture()
    const logger = createLogger('replica', { destination: sink })

    logger.info({ region: 'private' }, 'opened')

    const entry: unknown = JSON.parse(sink.lines[0] ?? '{}')

    expect(entry).toMatchObject({ module: 'replica', region: 'private', msg: 'opened', level: 30 })
  })

  it('drops entries below the configured level', () => {
    const sink = capture()
    const logger = createLogger('replica', { destination: sink, level: 'warn' })

    logger.info('hidden')
    logger.warn('shown')

    expect(sink.lines).toHaveLength(1)
  })

  it('prints a readable line in human format', () => {
    const sink = capture()
    const logger = createLogger('replica', { destination: sink, format: 'human' })

    logger.warn({ region: 'private' }, 'slow projection')

    expect(sink.lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} WARN \[replica\] slow projection \{"region":"private"\}\n$/,
    )
  })
})

describe('readLogConfig', () => {
  it('reads the level and format from the environment with defaults', () => {
    expect(readLogConfig({})).toEqual({ level: 'info', format: 'json' })
    expect(readLogConfig({ LOG_LEVEL: 'debug', LOG_FORMAT: 'human' })).toEqual({
      level: 'debug',
      format: 'human',
    })
  })

  it('rejects an unknown level', () => {
    expect(() => readLogConfig({ LOG_LEVEL: 'loud' })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'

import { createLogger } from './client'

describe('client createLogger', () => {
  it('binds the module name and honours the level', () => {
    const logger = createLogger('shell', { level: 'error' })

    expect(logger.bindings()).toEqual({ module: 'shell' })
    expect(logger.isLevelEnabled('warn')).toBe(false)
    expect(logger.isLevelEnabled('error')).toBe(true)
  })
})

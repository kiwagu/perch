import { describe, expect, it } from 'vitest'

import { version } from './index'

describe('modeling package', () => {
  it('exposes a version', () => {
    expect(version).toBe('0.1.0')
  })
})

import { describe, expect, it } from 'vitest'

import { checkProfileName } from './profile-name.rule'

describe('checkProfileName', () => {
  it('trims a name and refuses one that is blank or too long', () => {
    expect(checkProfileName('  Ann  ')._unsafeUnwrap()).toBe('Ann')
    expect(checkProfileName('   ')._unsafeUnwrapErr()).toEqual([{ code: 'profile:NAME_REQUIRED' }])
    expect(checkProfileName('x'.repeat(81))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:NAME_TOO_LONG' },
    ])
  })
})

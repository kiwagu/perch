import { describe, expect, it } from 'vitest'

import { memoryStorage } from './key-value'
import { forgetSigningOut, saveSigningOut, signingOutSince } from './signing-out'

describe('a sign-out under way', () => {
  it('keeps when it began for every tab, until it is forgotten', () => {
    const storage = memoryStorage()

    expect(signingOutSince(storage)).toBeUndefined()

    saveSigningOut(storage, 1_700_000_000_000)

    expect(signingOutSince(storage)).toBe(1_700_000_000_000)

    forgetSigningOut(storage)

    expect(signingOutSince(storage)).toBeUndefined()
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
  })

  it('reads no time from a value that is not one', () => {
    const storage = memoryStorage()

    storage.set('perch.session.signing-out', 'soon')

    expect(signingOutSince(storage)).toBeUndefined()
  })
})

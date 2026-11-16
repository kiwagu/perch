import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { accountIdOf } from './account-card.entity'

describe('accountIdOf', () => {
  it('is the identity id the address names', () => {
    const id = identityIdFactory.create()

    expect(accountIdOf({ id })).toBe(id)
  })

  it('is none where the address names no account, or something that is no identity id', () => {
    expect(accountIdOf({})).toBeUndefined()
    expect(accountIdOf({ id: 'nobody' })).toBeUndefined()
    expect(accountIdOf({ id: `tnt_${identityIdFactory.create().slice(4)}` })).toBeUndefined()
  })
})

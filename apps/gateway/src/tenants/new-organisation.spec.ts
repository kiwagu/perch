import { describe, expect, it } from 'vitest'

import { MAX_ORGANISATION_NAME, newOrganisationOf } from './new-organisation'

describe('newOrganisationOf', () => {
  it('answers the key as it is and the name trimmed', () => {
    expect(newOrganisationOf({ key: 'acme', name: '  Acme Corp ' })._unsafeUnwrap()).toEqual({
      key: 'acme',
      name: 'Acme Corp',
    })
  })

  it.each(['Acme', 'a', 'acme-corp', '1acme', `a${'b'.repeat(32)}`, ''])(
    'refuses the key %j',
    (key) => {
      expect(newOrganisationOf({ key, name: 'Acme' })._unsafeUnwrapErr()).toBe('key-invalid')
    },
  )

  it.each(['', '   '])('refuses the name %j with nothing left once trimmed', (name) => {
    expect(newOrganisationOf({ key: 'acme', name })._unsafeUnwrapErr()).toBe('name-required')
  })

  it('takes a name of 80 characters once trimmed and refuses 81', () => {
    const name = (length: number) => ` ${'x'.repeat(length)} `

    expect(newOrganisationOf({ key: 'acme', name: name(MAX_ORGANISATION_NAME) }).isOk()).toBe(true)
    expect(
      newOrganisationOf({ key: 'acme', name: name(MAX_ORGANISATION_NAME + 1) })._unsafeUnwrapErr(),
    ).toBe('name-too-long')
  })

  it('names the key before the name when both break a rule', () => {
    expect(newOrganisationOf({ key: 'A', name: '' })._unsafeUnwrapErr()).toBe('key-invalid')
  })
})

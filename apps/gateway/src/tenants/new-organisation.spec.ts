import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { newOrganisationOf } from './new-organisation'

/** The most characters an organisation's name and its key have, as the contract says it. */
const { maxLength: MAX } = CONTRACT_VALUES['organisation-name']
const { maxLength: MAX_KEY } = CONTRACT_VALUES['organisation-key']

describe('newOrganisationOf', () => {
  it('answers the key as it is and the name trimmed', () => {
    expect(newOrganisationOf({ key: 'acme', name: '  Acme Corp ' })._unsafeUnwrap()).toEqual({
      key: 'acme',
      name: 'Acme Corp',
    })
  })

  it.each(['Acme', 'a', 'acme-corp', '1acme', 'a'.repeat(MAX_KEY + 1), ''])(
    'refuses the key %j',
    (key) => {
      expect(newOrganisationOf({ key, name: 'Acme' })._unsafeUnwrapErr()).toBe('key-invalid')
    },
  )

  it.each(['', '   '])('refuses the name %j with nothing left once trimmed', (name) => {
    expect(newOrganisationOf({ key: 'acme', name })._unsafeUnwrapErr()).toBe('name-required')
  })

  it('takes a name of the limit once trimmed and refuses one past it', () => {
    const name = (length: number) => ` ${'x'.repeat(length)} `

    expect(newOrganisationOf({ key: 'acme', name: name(MAX) }).isOk()).toBe(true)
    expect(newOrganisationOf({ key: 'acme', name: name(MAX + 1) })._unsafeUnwrapErr()).toBe(
      'name-too-long',
    )
  })

  it('names the key before the name when both break a rule', () => {
    expect(newOrganisationOf({ key: 'A', name: '' })._unsafeUnwrapErr()).toBe('key-invalid')
  })
})

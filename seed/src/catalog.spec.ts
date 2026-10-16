import { describe, expect, it } from 'vitest'

import { checkProfileName } from '@workspace/web/seeding'

import { accountFor, catalog, validateCatalog } from './catalog'

const [first] = catalog.accounts

describe('seed catalog', () => {
  it('passes its own validation, and the profile accepts every name', () => {
    expect(validateCatalog(catalog).isOk()).toBe(true)

    for (const preset of catalog.accounts) {
      expect(checkProfileName(preset.name).isOk()).toBe(true)
    }
  })

  it('refuses a duplicate ref, a malformed ref and an empty name', () => {
    const preset = first ?? expect.unreachable('a preset')

    expect(validateCatalog({ accounts: [preset, preset] })._unsafeUnwrapErr()).toContain(
      `duplicate ref ${preset.ref}`,
    )
    expect(validateCatalog({ accounts: [{ ...preset, ref: 'Not A Ref' }] }).isErr()).toBe(true)
    expect(validateCatalog({ accounts: [{ ...preset, name: ' ' }] }).isErr()).toBe(true)
  })

  it('gives a demo account the same address every run and a fresh account a new one', () => {
    const preset = first ?? expect.unreachable('a preset')
    const demo = accountFor(preset, { kind: 'demo' })
    const one = accountFor(preset, { kind: 'fresh', run: 'r1' })
    const two = accountFor(preset, { kind: 'fresh', run: 'r2' })

    expect(accountFor(preset, { kind: 'demo' })).toEqual(demo)
    expect(one.email).not.toBe(two.email)

    for (const account of [demo, one, two]) {
      expect(account.email).toMatch(/^[a-z0-9.-]+@example\.test$/)
      expect(account.password.length).toBeGreaterThanOrEqual(8)
      expect(account.name).toBe(preset.name)
    }
  })
})

import { describe, expect, it } from 'vitest'

import { isTenantKey, keepsPasswordRules } from '@workspace/kernel'
import { checkProfileName } from '@workspace/web/seeding'

import { accountFor, catalog, organisationFor, validateCatalog } from './catalog'

const [first] = catalog.accounts

describe('seed catalog', () => {
  it('passes its own validation, and the profile accepts every name', () => {
    expect(validateCatalog(catalog).isOk()).toBe(true)

    for (const preset of catalog.accounts) {
      expect(checkProfileName(preset.name).isOk()).toBe(true)
    }
  })

  it('marks exactly one account an operator, on the seed domain in every mode', () => {
    const operators = catalog.accounts.filter((preset) => preset.operator === true)

    expect(operators.map((preset) => preset.ref)).toEqual(['ann'])

    for (const mode of [{ kind: 'demo' }, { kind: 'fresh', run: 'r1' }] as const) {
      for (const preset of operators) {
        expect(accountFor(preset, mode).email).toMatch(/^[a-z0-9.-]+@example\.test$/)
      }
    }
  })

  it('refuses an operator mark that is not a boolean', () => {
    const marked = (operator: unknown) =>
      validateCatalog({
        ...catalog,
        accounts: catalog.accounts.map((preset) => ({ ...preset, operator })),
      })

    expect(marked(true).isOk()).toBe(true)
    expect(marked('yes').isErr()).toBe(true)
  })

  it('refuses a duplicate ref, a malformed ref and an empty name', () => {
    const preset = first ?? expect.unreachable('a preset')

    expect(
      validateCatalog({ ...catalog, accounts: [preset, preset] })._unsafeUnwrapErr(),
    ).toContain(`duplicate ref ${preset.ref}`)
    expect(
      validateCatalog({ ...catalog, accounts: [{ ...preset, ref: 'Not A Ref' }] }).isErr(),
    ).toBe(true)
    expect(validateCatalog({ ...catalog, accounts: [{ ...preset, name: ' ' }] }).isErr()).toBe(true)
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
      expect(account.password).toBe(`Seed-${preset.ref}-password-1`)
      expect(keepsPasswordRules(account.password)).toBe(true)
      expect(account.name).toBe(preset.name)
    }
  })

  it('refuses a ref whose password would break the rules of a new password', () => {
    const preset = first ?? expect.unreachable('a preset')
    const longest = 'a'.repeat(19)
    const tooLong = 'a'.repeat(20)
    const withOne = (ref: string) =>
      validateCatalog({ ...catalog, accounts: [...catalog.accounts, { ...preset, ref }] })

    expect(accountFor({ ...preset, ref: longest }, { kind: 'demo' }).password).toHaveLength(35)
    expect(withOne(longest).isOk()).toBe(true)
    expect(withOne(tooLong)._unsafeUnwrapErr()).toEqual([
      `account ${tooLong}: its password breaks the rules of a new password`,
    ])
  })

  it('describes an organisation of existing accounts, keyed for a demo and a fresh run', () => {
    const [acme] = catalog.organisations
    const preset = acme ?? expect.unreachable('an organisation')
    const refs = catalog.accounts.map((account) => account.ref)

    expect(refs).toContain(preset.admin)
    expect(preset.members.every((member) => refs.includes(member))).toBe(true)
    expect(organisationFor(preset, { kind: 'demo' })).toEqual({ key: 'acme', name: 'Acme Corp' })

    const fresh = organisationFor(preset, { kind: 'fresh', run: Date.now().toString(36) })

    expect(fresh.key).toMatch(/^acme_[a-z0-9]+$/)
    expect(isTenantKey(fresh.key)).toBe(true)
    expect(organisationFor(preset, { kind: 'fresh', run: 'r1' }).key).not.toBe(
      organisationFor(preset, { kind: 'fresh', run: 'r2' }).key,
    )
  })

  it('refuses an organisation whose admin or member is no account, or whose key is malformed', () => {
    const [acme] = catalog.organisations
    const preset = acme ?? expect.unreachable('an organisation')
    const check = (organisation: unknown) =>
      validateCatalog({ ...catalog, organisations: [organisation] })

    expect(check({ ...preset, admin: 'nobody' })._unsafeUnwrapErr()).toContain(
      'organisation acme: admin nobody is no account',
    )
    expect(check({ ...preset, members: ['nobody'] })._unsafeUnwrapErr()).toContain(
      'organisation acme: member nobody is no account',
    )
    expect(check({ ...preset, key: 'Not-A-Key' })._unsafeUnwrapErr()).toContain(
      'organisation acme: key Not-A-Key is not a tenant key',
    )
  })

  it('refuses a key a fresh run makes too long, and a key valid only with a run suffix', () => {
    const [acme] = catalog.organisations
    const preset = acme ?? expect.unreachable('an organisation')
    const run = 'r'.repeat(40)

    expect(validateCatalog(catalog, { kind: 'fresh', run: 'r1' }).isOk()).toBe(true)
    expect(validateCatalog(catalog, { kind: 'fresh', run })._unsafeUnwrapErr()).toEqual([
      `organisation acme: key acme_${run} is not a tenant key`,
    ])
    expect(
      validateCatalog(
        { ...catalog, organisations: [{ ...preset, key: 'a' }] },
        { kind: 'fresh', run: 'r1' },
      )._unsafeUnwrapErr(),
    ).toEqual(['organisation acme: key a is not a tenant key'])
  })
})

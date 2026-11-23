import { describe, expect, it } from 'vitest'

import { PLATFORM_FILE, TERMS_FILE, type Terms, type WrittenDescription } from '../files'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { contractProblems } from './run'
import { synonymsProblems } from './synonyms'

const SCREEN_FILE = 'contract/domain/screens/sample/$key.yaml'

const TERMS: Terms = {
  contexts: { sample: { meaning: 'The sample platform.' } },
  terms: {
    organisation: { meaning: 'Accounts that work together.', synonyms: ['tenant', 'org'] },
    session: { meaning: 'One sign-in of a device.', synonyms: ['device session'] },
  },
  roles: {
    guest: { meaning: 'Nobody is signed in.' },
    member: { meaning: 'A member of the organisation.', synonyms: ['participant'] },
  },
}

/** The sample with `terms` and the descriptions `texts` of its screen file. */
function withTerms(terms: Terms | undefined, texts: readonly string[] = []): Contract {
  const contract = sampleContract()
  const descriptions = texts.map(
    (text, index): WrittenDescription => ({
      file: SCREEN_FILE,
      line: index + 4,
      at: ['anchors', `sample.item-${index}`, 'description'],
      kind: 'anchor',
      place: `sample.item-${index}`,
      text,
    }),
  )

  return { ...contract, terms, termsLines: {}, descriptions }
}

const said = (index: number, written: string, synonym: string, of: string) => ({
  file: SCREEN_FILE,
  line: index + 4,
  message: `anchors["sample.item-${index}"].description: the description of sample.item-${index} says "${written}", a synonym of ${of}; write "${synonym}"`,
})

describe('synonymsProblems', () => {
  it('runs in the contract check', () => {
    expect(contractProblems(withTerms(TERMS, ['The tenant of the thing.']))).toContainEqual(
      said(0, 'tenant', 'organisation', 'the term "organisation"'),
    )
  })
  it('passes a contract without a terms file, and texts that use the terms', () => {
    expect(synonymsProblems(withTerms(undefined, ['The tenant of the thing.']))).toEqual([])
    expect(
      synonymsProblems(withTerms(TERMS, ['The organisation of the thing, for a member.'])),
    ).toEqual([])
  })
  it('refuses a synonym in a written description, at its line, naming the term to write', () => {
    expect(synonymsProblems(withTerms(TERMS, ['The tenant of the thing.']))).toEqual([
      said(0, 'tenant', 'organisation', 'the term "organisation"'),
    ])
  })
  it('reads whole words in any case, with a plural or a possessive, never a part of a word', () => {
    expect(
      synonymsProblems(
        withTerms(TERMS, [
          'Tenants share it.',
          "The tenant's key.",
          'Its tenancy and its organisations.',
          'The ORG.',
        ]),
      ),
    ).toEqual([
      said(0, 'Tenants', 'organisation', 'the term "organisation"'),
      said(1, 'tenant', 'organisation', 'the term "organisation"'),
      said(3, 'ORG', 'organisation', 'the term "organisation"'),
    ])
  })
  it("reads a synonym of several words across a space or a dash, and a role's synonym", () => {
    expect(
      synonymsProblems(
        withTerms(TERMS, ['Its device-session id.', 'The device sessions.', 'A participant.']),
      ),
    ).toEqual([
      said(0, 'device-session', 'session', 'the term "session"'),
      said(1, 'device sessions', 'session', 'the term "session"'),
      said(2, 'participant', 'member', 'the role "member"'),
    ])
  })
  it('names each synonym of a text once, at its first place', () => {
    expect(synonymsProblems(withTerms(TERMS, ['A tenant and a tenant.']))).toEqual([
      said(0, 'tenant', 'organisation', 'the term "organisation"'),
    ])
  })
  it("refuses one in an action's outcome lines, its codes' conditions and an invariant's rule", () => {
    const contract = withTerms(TERMS)

    contract.screens.platform.actions = {
      'sign-out': {
        description: 'Signs this device out.',
        params: {},
        result: ['the device session ends'],
        codes: { failed: 'the tenant is gone', gone: { invariant: 'kept' } },
        changes: [],
      },
    }
    contract.screens.platform.invariants = {
      kept: { rule: 'A tenant keeps one member.', refuses: 'gone' },
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: PLATFORM_FILE,
        message: `actions["sign-out"].result[0]: the outcome line says "device session", a synonym of the term "session"; write "session"`,
      },
      {
        file: PLATFORM_FILE,
        message: `actions["sign-out"].codes.failed: the condition says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: PLATFORM_FILE,
        message: `invariants.kept.rule: the rule says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in an action's name and a screen's id", () => {
    const contract = withTerms(TERMS)
    const sample = contract.screens.screens[1]

    contract.screens.platform.actions = {
      'tenants.list': {
        description: 'Lists them.',
        params: {},
        result: 'them',
        codes: {},
        changes: [],
      },
    }
    if (sample !== undefined) {
      contract.screens.screens[1] = { ...sample, id: 'org' }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: PLATFORM_FILE,
        message: `actions["tenants.list"]: the action's name says "tenants", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: SCREEN_FILE,
        message: `id: the screen's id says "org", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it('refuses one in what the engine emits: a route path and a role name', () => {
    const contract = withTerms({
      ...TERMS,
      roles: { ...TERMS.roles, 'tenant-admin': { meaning: 'Runs the organisation.' } },
    })
    const sample = contract.screens.screens[1]

    if (sample?.bindings[0] !== undefined) {
      sample.bindings[0] = { ...sample.bindings[0], path: '/org/$key' }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: SCREEN_FILE,
        message: `bindings[0].path: the route's path says "org", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: TERMS_FILE,
        message: `roles["tenant-admin"]: the role's name says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
})

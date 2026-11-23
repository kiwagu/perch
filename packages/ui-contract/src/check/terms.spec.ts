import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { writeContractRepository } from '../contract-repository.fixture'
import { TERMS_FILE, type Terms, VOCABULARY_FILE } from '../files'
import { repository, useRepositories } from '../repository.fixture'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { contractProblems, loadContract } from './run'
import { termsProblems } from './terms'

useRepositories()

const TERMS: Terms = {
  contexts: { sample: { meaning: 'The sample platform.' } },
  terms: {
    account: { meaning: 'Whoever signs in.', synonyms: ['user', 'login'], storage: 'identity' },
    organisation: { meaning: 'Accounts that work together.', synonyms: ['tenant'] },
  },
  roles: {
    guest: { meaning: 'Nobody is signed in on the device.' },
    member: { meaning: 'The signed-in account is a member of the current organisation.' },
  },
}

/** The sample with `terms`, its vocabulary writing the Roles section or not. */
function withTerms(terms: Terms | undefined, writesRoles = false): Contract {
  const contract = sampleContract()

  return { ...contract, vocabulary: { ...contract.vocabulary, writesRoles }, terms, termsLines: {} }
}

const atTerms = (message: string) => ({ file: TERMS_FILE, message })

describe('termsProblems', () => {
  it('runs in the contract check', () => {
    expect(contractProblems(withTerms({ ...TERMS, contexts: {} }))).toContainEqual(
      atTerms('contexts: the terms belong to a context: name one'),
    )
  })
  it('passes a contract with no terms file whose vocabulary lists the roles', () => {
    expect(termsProblems(withTerms(undefined, true))).toEqual([])
  })
  it('wants the roles somewhere: the vocabulary without a terms file', () => {
    expect(termsProblems(withTerms(undefined, false))).toEqual([
      {
        file: VOCABULARY_FILE,
        message: `no section "Roles" and no ${TERMS_FILE}: the roles are listed in one of them`,
      },
    ])
  })
  it('passes terms whose synonyms are words no term or role is named', () => {
    expect(termsProblems(withTerms(TERMS))).toEqual([])
  })
  it('refuses the vocabulary listing the roles beside the terms file: the roles have one source', () => {
    expect(termsProblems(withTerms(TERMS, true))).toEqual([
      {
        file: VOCABULARY_FILE,
        message: `section "Roles": the roles are in ${TERMS_FILE}, so the vocabulary does not list them`,
      },
    ])
  })
  it('refuses a synonym that is the name of a term or a role, its own term included', () => {
    const terms: Terms = {
      ...TERMS,
      terms: {
        ...TERMS.terms,
        account: { meaning: 'Whoever signs in.', synonyms: ['member', 'account'] },
      },
    }

    expect(termsProblems(withTerms(terms))).toEqual([
      atTerms(
        'terms.account.synonyms[0]: "member" names the role "member", so it is no synonym of "account"',
      ),
      atTerms(
        'terms.account.synonyms[1]: "account" names the term "account", so it is no synonym of "account"',
      ),
    ])
  })
  it('refuses a synonym two terms forbid, and one a term lists twice', () => {
    const terms: Terms = {
      ...TERMS,
      terms: {
        ...TERMS.terms,
        organisation: { meaning: 'Accounts that work together.', synonyms: ['tenant', 'tenant'] },
      },
      roles: { ...TERMS.roles, guest: { meaning: 'Nobody is signed in.', synonyms: ['user'] } },
    }

    expect(termsProblems(withTerms(terms))).toEqual([
      atTerms('terms.organisation.synonyms[1]: "tenant" is listed twice'),
      atTerms(
        'roles.guest.synonyms[0]: "user" is a synonym of "account" already; a synonym belongs to one term',
      ),
    ])
  })
  it('reads a synonym written with a dash as the same words as one written with a space', () => {
    const terms: Terms = {
      ...TERMS,
      terms: {
        ...TERMS.terms,
        session: { meaning: 'One sign-in of a device.', synonyms: ['device session'] },
        'device-link': { meaning: 'A link to a device.', synonyms: ['device-session'] },
        visit: { meaning: 'A visit.', synonyms: ['device link'] },
      },
    }

    expect(termsProblems(withTerms(terms))).toEqual([
      atTerms(
        'terms["device-link"].synonyms[0]: "device-session" is a synonym of "session" already; a synonym belongs to one term',
      ),
      atTerms(
        'terms.visit.synonyms[0]: "device link" names the term "device-link", so it is no synonym of "visit"',
      ),
    ])
  })
  it('reads a plural as the same synonym, as the check reads it, against a name too', () => {
    const terms: Terms = {
      ...TERMS,
      terms: {
        ...TERMS.terms,
        organisation: { meaning: 'Accounts that work together.', synonyms: ['tenant'] },
        region: { meaning: 'Where data lives.', synonyms: ['tenants'] },
        visit: { meaning: 'A visit.', synonyms: ['accounts'] },
      },
    }

    expect(termsProblems(withTerms(terms))).toEqual([
      atTerms(
        'terms.region.synonyms[0]: "tenants" is a synonym of "organisation" already; a synonym belongs to one term',
      ),
      atTerms(
        'terms.visit.synonyms[0]: "accounts" names the term "account", so it is no synonym of "visit"',
      ),
    ])
  })
  it('refuses a name that is a term and a role at once', () => {
    const terms: Terms = {
      ...TERMS,
      terms: { ...TERMS.terms, member: { meaning: 'One who belongs.' } },
    }

    expect(termsProblems(withTerms(terms))).toEqual([
      atTerms('roles.member: "member" is a term too; a name is a term or a role'),
    ])
  })
  it('wants at least one context', () => {
    expect(termsProblems(withTerms({ ...TERMS, contexts: {} }))).toEqual([
      atTerms('contexts: the terms belong to a context: name one'),
    ])
  })
})

describe('the roles of a contract with a terms file', () => {
  const ROLES = /\n## Roles\n[\s\S]*?(?=\n## Reserved anchors)/

  /** The fixture repository with `terms` written, and its vocabulary's Roles section dropped. */
  function moved(terms: string): string {
    const root = repository({})

    writeContractRepository(root)
    writeFileSync(join(root, TERMS_FILE), terms)

    const vocabulary = join(root, VOCABULARY_FILE)

    writeFileSync(vocabulary, readFileSync(vocabulary, 'utf8').replace(ROLES, ''))

    return root
  }

  it('are the roles of the terms file, with their meanings', () => {
    const root = moved(
      'contexts: { sample: { meaning: The sample. } }\nterms: {}\nroles:\n  guest: { meaning: Nobody is signed in. }\n  identity: { meaning: An account is signed in. }\n  member: { meaning: A member of the organisation. }\n',
    )
    const { contract, problems } = loadContract(root)

    expect(problems).toEqual([])
    expect(contract?.vocabulary.roles).toEqual({
      guest: 'Nobody is signed in.',
      identity: 'An account is signed in.',
      member: 'A member of the organisation.',
    })
    expect(contract?.vocabulary.writesRoles).toBe(false)
    expect(contract?.terms?.contexts).toEqual({ sample: { meaning: 'The sample.' } })
  })
  it("are the vocabulary's while the contract writes no terms file", () => {
    const root = repository({})

    writeContractRepository(root)

    const { contract } = loadContract(root)

    expect(contract?.terms).toBeUndefined()
    expect(contract?.vocabulary.writesRoles).toBe(true)
    expect(Object.keys(contract?.vocabulary.roles ?? {})).toEqual(['guest', 'identity', 'member'])
  })
  it('do not load from a terms file the schema refuses', () => {
    const { contract, problems } = loadContract(moved('contexts: {}\nterms: {}\n'))

    expect(contract).toBeUndefined()
    expect(problems.map(({ file }) => file)).toEqual([TERMS_FILE])
  })
})

import { describe, expect, it } from 'vitest'

import { repository, useRepositories } from '../../repository.fixture'
import { TERMS_FILE } from '../paths'

import { readDescriptions } from './read'
import { termsDescriptions } from './terms'

useRepositories()

const TERMS = {
  contexts: { sample: { meaning: 'The sample platform.' } },
  terms: { account: { meaning: 'Whoever signs in.', synonyms: ['user'] } },
  roles: { guest: { meaning: 'Nobody is signed in.' } },
}

describe('termsDescriptions', () => {
  it('reads the meaning of each context, term and role, by its name, in the order of the file', () => {
    expect(termsDescriptions(TERMS)).toEqual([
      {
        at: ['contexts', 'sample', 'meaning'],
        kind: 'context',
        place: 'context sample',
        text: 'The sample platform.',
      },
      {
        at: ['terms', 'account', 'meaning'],
        kind: 'term',
        place: 'term account',
        text: 'Whoever signs in.',
      },
      {
        at: ['roles', 'guest', 'meaning'],
        kind: 'role',
        place: 'role guest',
        text: 'Nobody is signed in.',
      },
    ])
  })
  it('reads nothing of a section the file leaves out or writes wrong', () => {
    expect(termsDescriptions({ terms: [], roles: { guest: { meaning: 3 } } })).toEqual([])
  })
})

describe('readDescriptions with a terms file', () => {
  it('reads its meanings beside the descriptions of the other files, with their lines', () => {
    const root = repository({
      [TERMS_FILE]:
        'contexts:\n  sample:\n    meaning: The sample platform.\nterms: {}\nroles: {}\n',
    })
    const { descriptions, problems } = readDescriptions(root)

    expect(problems.map(({ file }) => file)).not.toContain(TERMS_FILE)
    expect(descriptions.filter(({ file }) => file === TERMS_FILE)).toEqual([
      {
        file: TERMS_FILE,
        line: 3,
        at: ['contexts', 'sample', 'meaning'],
        kind: 'context',
        place: 'context sample',
        text: 'The sample platform.',
      },
    ])
  })
  it('reads none when the contract writes no terms file', () => {
    const { descriptions } = readDescriptions(repository({}))

    expect(descriptions.filter(({ file }) => file === TERMS_FILE)).toEqual([])
  })
})

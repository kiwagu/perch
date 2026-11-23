import { describe, expect, it } from 'vitest'

import { repository, useRepositories } from '../repository.fixture'

import { TERMS_FILE } from './paths'
import { loadTerms } from './terms'

useRepositories()

const TERMS = `contexts:
  sample:
    meaning: The sample platform.
terms:
  account:
    meaning: Whoever signs in, with an email and a password.
    synonyms: [ user, login ]
    storage: identity
roles:
  guest:
    meaning: Nobody is signed in on the device.
  member:
    meaning: The signed-in account is a member of the current organisation.
    synonyms: [ participant ]
`

describe('loadTerms', () => {
  it('reads no terms when the contract writes no terms file', () => {
    expect(loadTerms(repository({}))).toEqual({ lines: {}, problems: [] })
  })
  it('reads the contexts, the terms and the roles, with the line of each key', () => {
    const { terms, lines, problems } = loadTerms(repository({ [TERMS_FILE]: TERMS }))

    expect(problems).toEqual([])
    expect(terms).toEqual({
      contexts: { sample: { meaning: 'The sample platform.' } },
      terms: {
        account: {
          meaning: 'Whoever signs in, with an email and a password.',
          synonyms: ['user', 'login'],
          storage: 'identity',
        },
      },
      roles: {
        guest: { meaning: 'Nobody is signed in on the device.' },
        member: {
          meaning: 'The signed-in account is a member of the current organisation.',
          synonyms: ['participant'],
        },
      },
    })
    expect(lines['roles.member']).toBe(12)
  })
  it('reports what the schema refuses, at its path, and reads no terms then', () => {
    const { terms, problems } = loadTerms(
      repository({
        [TERMS_FILE]: TERMS.replace('synonyms: [ user, login ]', 'synonyms: [ User ]').replace(
          'storage: identity',
          'storage: Identity Table',
        ),
      }),
    )

    expect(terms).toBeUndefined()
    expect(problems.map(({ file, message }) => `${file}: ${message.split(':')[0]}`)).toEqual([
      `${TERMS_FILE}: terms.account.synonyms[0]`,
      `${TERMS_FILE}: terms.account.storage`,
    ])
  })
  it('refuses a key the file does not know and a section it lacks', () => {
    const { problems } = loadTerms(
      repository({ [TERMS_FILE]: TERMS.replace(/^roles:[\s\S]*$/m, 'glossary: {}\n') }),
    )

    expect(problems.map(({ message }) => message.split(':')[0])).toEqual(['roles', '(root)'])
  })
  it('reports a file that is not YAML', () => {
    const { terms, problems } = loadTerms(repository({ [TERMS_FILE]: 'contexts: [\n' }))

    expect(terms).toBeUndefined()
    expect(problems).toHaveLength(1)
    expect(problems[0]?.file).toBe(TERMS_FILE)
  })
})

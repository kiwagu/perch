import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkContract, keyProblems, parameterSample } from '../../check'
import { writeContractRepository } from '../../contract-repository.fixture'
import { contractAt } from '../../manifest/manifest.fixture'
import { PLATFORM_FILE, VOCABULARY_FILE } from '../paths'
import { formatProblem } from '../problems'
import { loadScreens } from '../screens'

const SCREEN_FILE = 'contract/domain/screens/landing.yaml'

const PLATFORM_ADDITIONS = `  open:
    description: Opens what a token names.
    params:
      token:
        value: token
        codes: [ link-invalid, link-expired ]
        description: The token the link of the mail carries.
    result: the landing shows what the token names
    codes: [ link-invalid, link-expired, failed ]
    changes: []
  invite:
    description: Sends the mail whose link opens the landing.
    params:
      email: { type: string, maxLength: 254, description: Who the mail goes to. }
    result: the mail is on its way
    codes: [ failed ]
    changes: []
    mail:
      to: email
      language: account
      link: { screen: sample.landing, search: token }
values:
  token:
    type: string
    minLength: 1
    maxLength: 4096
    description: The token the link of a mail carries.
    examples: [ token-0123456789abcdef ]
`

const ROWS: Record<string, string> = {
  Kinds: '| `error` | a failure text | |',
  Codes:
    '| `link-invalid` | `sample.landing.error` | the link is unknown, used or replaced |\n| `link-expired` | `sample.landing.error` | the link is too old |',
  'Screen names in use': '| `sample.landing` | what the link of the mail opens (`/landing`) |',
}

/** The landing the link opens: it writes the token's parameter itself (version 3) or leaves it out. */
const landingText = (written: boolean): string => `id: sample.landing
title: Landing
description: What the link of the mail opens.
flag: null
bindings:
  - path: /landing
    roles: [ guest, identity ]
${
  written
    ? `    search:
      type: object
      properties:
        token:
          type: string
          minLength: 1
          maxLength: 4096
          description: The token the link of a mail carries.
          examples: [ token-0123456789abcdef ]
      additionalProperties: false
`
    : ''
}entry: [ sample.landing.page, sample.landing.error ]
anchors:
  sample.landing.page:
    kind: page
    description: The root of the screen.
  sample.landing.error:
    kind: error
    description: Why the token did not open the landing.
flow:
  initial: opening
  states:
    opening:
      invoke:
        src: platform.open
        input: { token: { search: token } }
        onDone: done
        onError: failed
    done:
      type: final
    failed:
      type: final
`

/** `markdown` with `rows` appended to the table of `section`. */
function withRows(markdown: string, section: string, rows: string): string {
  const start = markdown.indexOf(`## ${section}\n`)
  const next = markdown.indexOf('\n## ', start + 1)
  const end = next === -1 ? markdown.length : next

  return `${markdown.slice(0, end).trimEnd()}\n${rows}\n${markdown.slice(end)}`
}

const roots: string[] = []

/** The sample at `version` with the landing a mail links to, its parameter `written` or left out. */
function repositoryAt(version: number, written: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-mail-links-'))

  roots.push(root)
  writeContractRepository(root)
  writeFileSync(
    join(root, PLATFORM_FILE),
    readFileSync(join(root, PLATFORM_FILE), 'utf8')
      .replace('version: 1', `version: ${version}`)
      .replace('reserved:', `${PLATFORM_ADDITIONS}reserved:`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8').replace(
    'Contract version: 1\n\n',
    '',
  )

  for (const [section, rows] of Object.entries(ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, SCREEN_FILE), landingText(written))

  return root
}

/** The search parameters of the landing's one route, as the loader holds them. */
function searchOf(root: string) {
  const landing = loadScreens(root).screens?.screens.find(({ id }) => id === 'sample.landing')

  return landing?.bindings[0]?.search
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('a screen a mail links to, on a repository', () => {
  it('passes the check at version 3 with the parameter written, and at version 4 with it left out', () => {
    expect(checkContract(repositoryAt(3, true)).map(formatProblem)).toEqual([])
    expect(checkContract(repositoryAt(4, false)).map(formatProblem)).toEqual([])
  })
  it('loads at version 4 the parameter the version 3 file writes, with the key beside it', () => {
    const written = repositoryAt(3, true)
    const bare = repositoryAt(4, false)

    expect(readFileSync(join(bare, SCREEN_FILE), 'utf8')).not.toContain('additionalProperties')
    expect(searchOf(bare)).toEqual({
      ...searchOf(written),
      properties: {
        token: { ...searchOf(written)?.properties['token'], 'x-perch': { key: 'link-invalid' } },
      },
    })
  })
  it('has a derived parameter whose examples the check samples, a key the check holds to the actions', () => {
    const contract = contractAt(repositoryAt(4, false))
    const landing = contract.screens.screens.find(({ id }) => id === 'sample.landing')
    const token = landing?.bindings[0]?.search?.properties['token']

    expect(token?.['x-perch']).toEqual({ key: 'link-invalid' })
    expect(keyProblems(contract)).toEqual([])
    expect(token === undefined ? undefined : parameterSample(token, 'search')).toBe(
      'token-0123456789abcdef',
    )
  })
  it('refuses at version 4 the parameter the file still writes', () => {
    const problems = checkContract(repositoryAt(4, true)).map(formatProblem)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      'bindings[0].search.properties.token: derived from the mail link of the platform action "invite"; leave it out',
    )
  })
})

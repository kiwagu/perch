import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { checkContract } from '../check'
import { writeContractRepository } from '../contract-repository.fixture'
import { diffContracts, formatChanges } from '../handoff'
import { contractAt } from '../manifest/manifest.fixture'
import { recordOf } from '../records'

import { PLATFORM_FILE, VOCABULARY_FILE } from './paths'
import { loadScreens } from './screens'

const SCREEN_FILE = 'contract/domain/screens/sign-in.yaml'

const PLATFORM_ADDITIONS = `  sign-in:
    description: Signs in.
    params:
      email: { type: string, description: The email. }
      password: { type: string, description: The password. }
    result: the device is signed in
    codes: [ invalid-credentials, failed ]
composites:
  password-rules:
    description: The rules a new password keeps.
    list: password-rule-list
    itemState: met
    items:
      length: 10 to 35 characters.
      digit: At least one digit.
`

const ROWS: Record<string, string> = {
  Kinds: '| `error` | a failure text | |',
  'Row states': '| `met` | the items of `password-rules` | the password typed keeps this rule |',
  Codes:
    '| `invalid-credentials` | `sample.sign-in.error` | the email or the password is wrong |\n| `passwords-differ` | `sample.sign-in.error` | the password typed again differs |',
  'Screen names in use': '| `sample.sign-in` | the sign-in of the sample (`/sign-in`) |',
  Composites: '| `password-rules` | the rules a new password keeps |',
}

const HEAD = `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.sign-in
title: Sign in
description: Where the sample signs in.
flag: null
bindings: [ { path: /sign-in, guard: guest, roles: [ guest ] } ]
entry: [ sample.sign-in.page ]
anchors:
  sample.sign-in.page:
    kind: page
    description: The root of the screen.
  sample.sign-in.email-input:
    kind: input
    description: The email (type email).
    binding: { action: platform.sign-in, params: { email: sample.sign-in.email-input } }
  sample.sign-in.password-input:
    kind: input
    secret: true
    description: The password (type password).
    binding: { action: platform.sign-in, params: { password: sample.sign-in.password-input } }
`

const WRITTEN_RULES = `  sample.sign-in.password-rule-list:
    kind: list
    description: The rules a new password keeps.
  sample.sign-in.password-rule-list.length-item:
    kind: item
    description: 10 to 35 characters.
    states: [ met ]
  sample.sign-in.password-rule-list.digit-item:
    kind: item
    description: At least one digit.
    states: [ met ]
`

const TAIL = (written: boolean) => `  sample.sign-in.error:
    kind: error
    description: Why the sign-in failed.
${written ? '    codes: [ invalid-credentials, passwords-differ, failed ]\n' : ''}  sample.sign-in.submit-button:
    kind: button
    description: Signs in.
    binding: { action: platform.sign-in${written ? ', params: { email: sample.sign-in.email-input, password: sample.sign-in.password-input }' : ''} }
flow:
  initial: idle
  meta:
    guards:
      passwordsDiffer: the password typed differs from the one typed first
  states:
    idle:
      on:
        sample.sign-in.submit-button: signing-in
        sample.sign-in.password-input:
          - target: differing
            guard: passwordsDiffer
    differing:
      entry:
        - show: { sample.sign-in.error: [ passwords-differ ] }
      exit:
        - clear: sample.sign-in.error
      on:
        sample.sign-in.password-input: idle
    signing-in:
${written ? '      entry:\n        - clear: sample.sign-in.error\n' : ''}      invoke:
        src: platform.sign-in
        input: { email: sample.sign-in.email-input, password: sample.sign-in.password-input }
        onDone:
          target: done
          actions:
            - navigate: /sample/$key
${written ? '        onError:\n          target: idle\n          actions:\n            - show: sample.sign-in.error\n' : ''}    done:
      type: final
`

/** The screen written in full, or compacted: the opt-in in place of the rules, no codes, params, entry or onError. */
const screenText = (written: boolean): string =>
  written
    ? `${HEAD}${WRITTEN_RULES}${TAIL(true)}`
    : `${HEAD.replace('    secret: true\n    description: The password (type password).\n', '    secret: true\n    composite: password-rules\n    description: The password (type password).\n')}${TAIL(false)}`

/** `markdown` with `rows` appended to the table of `section`. */
function withRows(markdown: string, section: string, rows: string): string {
  const start = markdown.indexOf(`## ${section}\n`)
  const next = markdown.indexOf('\n## ', start + 1)
  const end = next === -1 ? markdown.length : next

  return `${markdown.slice(0, end).trimEnd()}\n${rows}\n${markdown.slice(end)}`
}

const roots: string[] = []

function repositoryWith(written: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-compaction-'))

  roots.push(root)
  writeContractRepository(root)

  const platform = readFileSync(join(root, PLATFORM_FILE), 'utf8')

  writeFileSync(
    join(root, PLATFORM_FILE),
    platform.replace('reserved:', `${PLATFORM_ADDITIONS}reserved:`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8')

  for (const [section, rows] of Object.entries(ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, SCREEN_FILE), screenText(written))

  return root
}

/** What the compacted file leaves to the derivations, as the screen file under `root` writes it. */
function writtenFacetsAt(root: string): Record<string, unknown> {
  const file = recordOf(parse(readFileSync(join(root, SCREEN_FILE), 'utf8')))
  const anchors = recordOf(file['anchors'])
  const signingIn = recordOf(recordOf(recordOf(file['flow'])['states'])['signing-in'])

  return {
    composite: recordOf(anchors['sample.sign-in.password-input'])['composite'],
    rules: Object.keys(anchors).filter((id) => id.startsWith('sample.sign-in.password-rule-list')),
    codes: recordOf(anchors['sample.sign-in.error'])['codes'],
    params: recordOf(recordOf(anchors['sample.sign-in.submit-button'])['binding'])['params'],
    entry: signingIn['entry'],
    onError: recordOf(signingIn['invoke'])['onError'],
  }
}

/** A loaded screen without the keys only the compacted file gives it. */
const normalized = (screen: unknown): unknown =>
  JSON.parse(
    JSON.stringify(screen, (key, value: unknown) =>
      key === 'composite' || key === 'derivedFrom' ? undefined : value,
    ),
  )

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('a screen compacted by the derivations', () => {
  it('leaves out what the screen written in full writes', () => {
    expect(writtenFacetsAt(repositoryWith(true))).toStrictEqual({
      composite: undefined,
      rules: [
        'sample.sign-in.password-rule-list',
        'sample.sign-in.password-rule-list.length-item',
        'sample.sign-in.password-rule-list.digit-item',
      ],
      codes: ['invalid-credentials', 'passwords-differ', 'failed'],
      params: { email: 'sample.sign-in.email-input', password: 'sample.sign-in.password-input' },
      entry: [{ clear: 'sample.sign-in.error' }],
      onError: { target: 'idle', actions: [{ show: 'sample.sign-in.error' }] },
    })
    expect(writtenFacetsAt(repositoryWith(false))).toStrictEqual({
      composite: 'password-rules',
      rules: [],
      codes: undefined,
      params: undefined,
      entry: undefined,
      onError: undefined,
    })
  })

  it('loads as the screen written in full, with the same anchors, codes, params and flow', () => {
    const written = loadScreens(repositoryWith(true))
    const compact = loadScreens(repositoryWith(false))
    const screenOf = (loaded: typeof written) =>
      loaded.screens?.screens.find(({ id }) => id === 'sample.sign-in')

    expect(written.problems).toEqual([])
    expect(compact.problems).toEqual([])
    expect(screenOf(written)).toBeDefined()
    expect(normalized(screenOf(compact))).toEqual(normalized(screenOf(written)))
    expect(Object.keys(screenOf(compact)?.anchors ?? {})).toEqual(
      Object.keys(screenOf(written)?.anchors ?? {}),
    )
    expect(screenOf(compact)?.anchors['sample.sign-in.password-rule-list']?.derivedFrom).toEqual({
      composite: 'password-rules',
    })
  })

  it('passes the contract check both ways, and the diff between the two is the descriptions the compacted one leaves to the composite', () => {
    const written = repositoryWith(true)
    const compact = repositoryWith(false)

    expect(checkContract(written)).toEqual([])
    expect(checkContract(compact)).toEqual([])
    expect(
      formatChanges(diffContracts(contractAt(written), contractAt(compact))).split('\n'),
    ).toEqual([
      'contract changes: 3 descriptions changed',
      'descriptions changed: sample.sign-in.password-rule-list 31 -> gone, sample.sign-in.password-rule-list.digit-item 19 -> gone, sample.sign-in.password-rule-list.length-item 20 -> gone',
    ])
  })
})

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { checkContract } from '../check'
import { writeContractRepository } from '../contract-repository.fixture'
import { diffContracts, formatChanges } from '../handoff'
import { walk } from '../machines'
import { contractAt } from '../manifest/manifest.fixture'
import { recordOf } from '../records'

import { PLATFORM_FILE, VOCABULARY_FILE } from './paths'
import { loadScreens } from './screens'
import { fieldValueOf } from './values'

const SCREEN_FILE = 'contract/domain/screens/sign-in.yaml'

const PLATFORM_ADDITIONS = `  sign-in:
    description: Signs in.
    params:
      email: { type: string, description: The email. }
      password: { type: string, description: The password. }
    result: the device is signed in
    codes: [ invalid-credentials, failed ]
    changes: []
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

/** The sign-in of the kinds' proof, written in full or leaving out what its kinds imply. */
const kindsScreenText = (written: boolean): string => `id: sample.sign-in
title: Sign in
description: Where the sample signs in.
flag: null
bindings: [ { path: /sign-in, roles: [ guest, identity, member ] } ]
entry: [ sample.sign-in.page ]
anchors:
  sample.sign-in.page:
    kind: page
    description: The root of the screen.
  sample.sign-in.password-input:
    kind: input
    secret: true
    description: The password (type password).
${written ? '    derived: [ visibility-button ]\n' : ''}  sample.sign-in.language-select:
    kind: select
    description: The language of the screen.
${written ? '    dataValue: true\n    derived: [ option ]\n' : ''}  sample.sign-in.leave-dialog:
    kind: dialog
    description: Asks whether to leave.
${written ? '    derived: [ confirm-button, cancel-button ]\n' : ''}  sample.sign-in.thing-link:
    kind: link
    description: Opens the thing.
    binding: { route: /sample/$key }
${written ? '    roles: [ member ]\n' : ''}`

const KINDS_ROWS: Record<string, string> = {
  Kinds: '| `dialog` | a question | |\n| `link` | a link | |\n| `select` | a choice | |',
  'Derived suffixes':
    '| `cancel-button` | the other answer of a dialog |\n| `visibility-button` | the eye of a password input |',
  'Screen names in use': '| `sample.sign-in` | the sign-in of the sample (`/sign-in`) |',
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

/** The sample at `version` whose sign-in is written in full (`written`) or leaves out what its kinds imply. */
function kindsRepositoryAt(version: number, written: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-kinds-'))

  roots.push(root)
  writeContractRepository(root)
  writeFileSync(
    join(root, PLATFORM_FILE),
    readFileSync(join(root, PLATFORM_FILE), 'utf8').replace('version: 1', `version: ${version}`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8').replace(
    'Contract version: 1\n\n',
    '',
  )

  for (const [section, rows] of Object.entries(KINDS_ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, SCREEN_FILE), kindsScreenText(written))

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

/** The four guards of a password pair, each with the sentence a screen file wrote for it. */
const PAIR_SENTENCES: Record<string, string> = {
  passwordBreaksRules: 'the password breaks one of the rules of sample.sign-in.password-rule-list',
  passwordsDiffer: 'the password typed again is not the same as the password',
  confirmationStrays:
    'the password typed again is no longer how the password begins: a character differs, or it is longer',
  confirmationFollows:
    'the password typed again is how the password begins, all of it or a part, or is empty',
}

const PAIR_PLATFORM = `  set-password:
    description: Sets a new password.
    params:
      password: { value: new-password, description: The new password. }
    result: the password is the new one
    codes: [ failed ]
    changes: []
values:
  new-password:
    type: string
    minLength: 10
    maxLength: 35
    description: A new password, kept to its rules.
composites:
  password-rules:
    description: The rules a new password keeps.
    list: password-rule-list
    itemState: met
    items:
      length: 10 to 35 characters.
      digit: At least one digit.
`

const PAIR_ROWS: Record<string, string> = {
  Kinds: '| `error` | a failure text | |',
  'Derived suffixes': '| `visibility-button` | the eye of a password input |',
  'Row states': '| `met` | the items of `password-rules` | the password typed keeps this rule |',
  Codes: '| `passwords-differ` | `sample.sign-in.error` | the password typed again differs |',
  'Screen names in use': '| `sample.sign-in` | the sign-in of the sample (`/sign-in`) |',
  Composites: '| `password-rules` | the rules a new password keeps |',
}

/** A new password typed twice, the confirmation naming the password (`confirms`), the flow writing the four sentences (`sentences`), or both. */
const pairScreenText = ({ confirms, sentences }: { confirms: boolean; sentences: boolean }) =>
  `id: sample.sign-in
title: Sign in
description: Where the sample sets a new password.
flag: null
bindings: [ { path: /sign-in, roles: [ guest ] } ]
entry: [ sample.sign-in.page ]
anchors:
  sample.sign-in.page:
    kind: page
    description: The root of the screen.
  sample.sign-in.password-input:
    kind: input
    secret: true
    composite: password-rules
    description: The new password.
    binding: { action: platform.set-password, params: { password: sample.sign-in.password-input } }
  sample.sign-in.password-confirmation-input:
    kind: input
    secret: true
    description: The new password typed again; never sent.
${confirms ? '    confirms: sample.sign-in.password-input\n' : ''}  sample.sign-in.submit-button:
    kind: button
    description: Sets the new password.
    binding: { action: platform.set-password }
  sample.sign-in.error:
    kind: error
    description: Why the password is not set.
    fields: { passwords-differ: sample.sign-in.password-confirmation-input }
flow:
  initial: weak
${
  sentences
    ? `  meta:\n    guards:\n${Object.entries(PAIR_SENTENCES)
        .map(([name, sentence]) => `      ${name}: "${sentence}"\n`)
        .join('')}`
    : ''
}  states:
    weak:
      on:
        sample.sign-in.password-input:
          - guard: passwordBreaksRules
          - target: differing
            guard: confirmationStrays
          - target: kept
    kept:
      on:
        sample.sign-in.password-input:
          - target: weak
            guard: passwordBreaksRules
          - target: differing
            guard: confirmationStrays
        sample.sign-in.password-confirmation-input:
          target: differing
          guard: confirmationStrays
        sample.sign-in.submit-button:
          - target: differing
            guard: passwordsDiffer
          - target: setting
    differing:
      entry:
        - show: { sample.sign-in.error: [ passwords-differ ] }
      exit:
        - clear: sample.sign-in.error
      on:
        sample.sign-in.password-input:
          - target: weak
            guard: passwordBreaksRules
          - target: kept
            guard: confirmationFollows
        sample.sign-in.password-confirmation-input:
          target: kept
          guard: confirmationFollows
    setting:
      invoke:
        src: platform.set-password
        input: { password: sample.sign-in.password-input }
        onDone: done
        onError:
          target: kept
          actions:
            - show: sample.sign-in.error
    done:
      type: final
`

/** The sample at `version` with the pair's sign-in, its confirmation and its sentences as `written` says. */
function pairRepositoryAt(
  version: number,
  written: { confirms: boolean; sentences: boolean },
): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-pairs-'))

  roots.push(root)
  writeContractRepository(root)

  const platform = readFileSync(join(root, PLATFORM_FILE), 'utf8')

  writeFileSync(
    join(root, PLATFORM_FILE),
    platform
      .replace('version: 1', `version: ${version}`)
      .replace('reserved:', `${PAIR_PLATFORM}reserved:`),
  )

  let vocabulary = readFileSync(join(root, VOCABULARY_FILE), 'utf8').replace(
    'Contract version: 1\n\n',
    '',
  )

  for (const [section, rows] of Object.entries(PAIR_ROWS)) {
    vocabulary = withRows(vocabulary, section, rows)
  }

  writeFileSync(join(root, VOCABULARY_FILE), vocabulary)
  writeFileSync(join(root, SCREEN_FILE), pairScreenText(written))

  return root
}

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

describe('a screen compacted by what its kinds imply', () => {
  const screenOf = (loaded: ReturnType<typeof loadScreens>) =>
    loaded.screens?.screens.find(({ id }) => id === 'sample.sign-in')

  /** What the sign-in as the screen file at `root` writes it says of its kinds' parts. */
  function writtenKindsAt(root: string): Record<string, unknown> {
    const anchors = recordOf(
      recordOf(parse(readFileSync(join(root, SCREEN_FILE), 'utf8')))['anchors'],
    )
    const of = (name: string) => recordOf(anchors[`sample.sign-in.${name}`])

    return {
      password: of('password-input')['derived'],
      select: [of('language-select')['dataValue'], of('language-select')['derived']],
      dialog: of('leave-dialog')['derived'],
      link: of('thing-link')['roles'],
    }
  }

  it('leaves out what the screen written in full writes', () => {
    expect(writtenKindsAt(kindsRepositoryAt(3, true))).toStrictEqual({
      password: ['visibility-button'],
      select: [true, ['option']],
      dialog: ['confirm-button', 'cancel-button'],
      link: ['member'],
    })
    expect(writtenKindsAt(kindsRepositoryAt(4, false))).toStrictEqual({
      password: undefined,
      select: [undefined, undefined],
      dialog: undefined,
      link: undefined,
    })
  })

  it('loads at version 4 as the screen written in full loads at version 3', () => {
    const written = loadScreens(kindsRepositoryAt(3, true))
    const compact = loadScreens(kindsRepositoryAt(4, false))

    expect(written.problems).toEqual([])
    expect(compact.problems).toEqual([])
    expect(written.screens?.version).toBe(3)
    expect(compact.screens?.version).toBe(4)
    expect(screenOf(written)?.anchors['sample.sign-in.language-select']).toMatchObject({
      dataValue: true,
      derived: ['option'],
    })
    expect(screenOf(compact)).toEqual(screenOf(written))
  })

  it('reads the compact screen at version 3 as it is written, deriving nothing', () => {
    const anchors = screenOf(loadScreens(kindsRepositoryAt(3, false)))?.anchors

    expect(anchors?.['sample.sign-in.language-select']?.derived).toBeUndefined()
    expect(anchors?.['sample.sign-in.language-select']?.dataValue).toBeUndefined()
    expect(anchors?.['sample.sign-in.leave-dialog']?.derived).toBeUndefined()
    expect(anchors?.['sample.sign-in.password-input']?.derived).toBeUndefined()
    expect(anchors?.['sample.sign-in.thing-link']?.roles).toBeUndefined()
  })

  it('refuses at version 4 what the screen written in full writes, one problem for each', () => {
    expect(loadScreens(kindsRepositoryAt(4, true)).problems.map(({ message }) => message)).toEqual([
      'anchors["sample.sign-in.password-input"].derived[0]: "visibility-button" is derived from its kind; leave it out',
      'anchors["sample.sign-in.language-select"].derived[0]: "option" is derived from its kind; leave it out',
      'anchors["sample.sign-in.language-select"].dataValue: dataValue is derived from its kind; leave it out',
      'anchors["sample.sign-in.leave-dialog"].derived[0]: "confirm-button" is derived from its kind; leave it out',
      'anchors["sample.sign-in.leave-dialog"].derived[1]: "cancel-button" is derived from its kind; leave it out',
      'anchors["sample.sign-in.thing-link"].roles: roles are derived from the route "/sample/$key"; leave them out',
    ])
  })

  it('passes the contract check both ways, with the same manifest of the sign-in', () => {
    const written = kindsRepositoryAt(3, true)
    const compact = kindsRepositoryAt(4, false)

    expect(checkContract(written)).toEqual([])
    expect(checkContract(compact)).toEqual([])
    expect(formatChanges(diffContracts(contractAt(written), contractAt(compact)))).toBe(
      'contract changes: none',
    )
  })
})

describe('a screen compacted by its password pair', () => {
  const WRITTEN = { confirms: false, sentences: true }
  const COMPACT = { confirms: true, sentences: false }
  const CONFIRMATION = 'sample.sign-in.password-confirmation-input'
  const DERIVED = {
    passwordBreaksRules: { composite: 'breaks' },
    passwordsDiffer: { confirms: 'differs' },
    confirmationStrays: { confirms: 'strays' },
    confirmationFollows: { confirms: 'follows' },
  }
  const screenOf = (loaded: ReturnType<typeof loadScreens>) =>
    loaded.screens?.screens.find(({ id }) => id === 'sample.sign-in')

  /** What the sign-in, as the screen file at `root` writes it, says of its pair. */
  function writtenPairAt(root: string): Record<string, unknown> {
    const file = recordOf(parse(readFileSync(join(root, SCREEN_FILE), 'utf8')))
    const anchors = recordOf(file['anchors'])

    return {
      confirms: recordOf(anchors[CONFIRMATION])['confirms'],
      guards: recordOf(recordOf(file['flow'])['meta'])['guards'],
    }
  }

  it('writes the confirms in place of the four guards', () => {
    expect(writtenPairAt(pairRepositoryAt(4, WRITTEN))).toStrictEqual({
      confirms: undefined,
      guards: PAIR_SENTENCES,
    })
    expect(writtenPairAt(pairRepositoryAt(4, COMPACT))).toStrictEqual({
      confirms: 'sample.sign-in.password-input',
      guards: undefined,
    })
  })

  it('loads at version 4 as the screen written in full, each guard derived in place of its sentence', () => {
    const written = loadScreens(pairRepositoryAt(4, WRITTEN))
    const compact = loadScreens(pairRepositoryAt(4, COMPACT))
    const flowOf = (loaded: typeof written) => screenOf(loaded)?.flow

    expect(written.problems).toEqual([])
    expect(compact.problems).toEqual([])
    expect(flowOf(written)?.meta?.guards).toEqual(PAIR_SENTENCES)
    expect(flowOf(compact)?.meta?.guards).toEqual(DERIVED)
    expect({ ...flowOf(compact), meta: undefined }).toEqual({ ...flowOf(written), meta: undefined })
    expect(screenOf(compact)?.anchors[CONFIRMATION]).toEqual({
      ...screenOf(written)?.anchors[CONFIRMATION],
      confirms: 'sample.sign-in.password-input',
    })
  })

  it('gives the confirmation the value of the password, which it has none of without the confirms', () => {
    const valueAt = (root: string, anchor: string) => {
      const { screens } = loadScreens(root)
      const screen = screens?.screens.find(({ id }) => id === 'sample.sign-in')

      return screens === undefined || screen === undefined
        ? 'not loaded'
        : fieldValueOf(anchor, screen, screens.platform, undefined)
    }
    const compact = pairRepositoryAt(4, COMPACT)

    expect(valueAt(pairRepositoryAt(4, WRITTEN), CONFIRMATION)).toBeUndefined()
    expect(valueAt(compact, 'sample.sign-in.password-input')).toEqual({
      type: 'string',
      minLength: 10,
      maxLength: 35,
    })
    expect(valueAt(compact, CONFIRMATION)).toEqual(
      valueAt(compact, 'sample.sign-in.password-input'),
    )
  })

  it('reads the four sentences at version 3 without a confirms as it did', () => {
    const loaded = loadScreens(pairRepositoryAt(3, WRITTEN))

    expect(loaded.problems).toEqual([])
    expect(screenOf(loaded)?.flow?.meta?.guards).toEqual(PAIR_SENTENCES)
  })

  it('refuses at version 4 the four sentences beside the confirms, and keeps them at version 3', () => {
    expect(
      loadScreens(pairRepositoryAt(4, { confirms: true, sentences: true })).problems.map(
        ({ message }) => message,
      ),
    ).toEqual(
      Object.keys(PAIR_SENTENCES).map(
        (name) =>
          `flow.meta.guards.${name}: derived from the confirms of ${CONFIRMATION}; leave it out`,
      ),
    )

    const kept = loadScreens(pairRepositoryAt(3, { confirms: true, sentences: true }))

    expect(kept.problems).toEqual([])
    expect(screenOf(kept)?.flow?.meta?.guards).toEqual(PAIR_SENTENCES)
  })

  it('runs in XState, every state reached and every branch taken where the flow says', () => {
    const flow = screenOf(loadScreens(pairRepositoryAt(4, COMPACT)))?.flow

    if (flow === undefined) {
      throw new Error('the sign-in has no flow')
    }

    const walked = walk(flow)

    expect(walked.visited).toEqual(['weak', 'differing', 'kept', 'setting', 'done'])
    expect(walked.cases.map(({ label }) => label)).toContain('kept sample.sign-in.submit-button[0]')
    expect(
      walked.cases.filter(
        ({ expected, actual }) => JSON.stringify(expected) !== JSON.stringify(actual),
      ),
    ).toEqual([])
  })

  it('passes the contract check both ways, the diff listing each derived guard', () => {
    const written = pairRepositoryAt(4, WRITTEN)
    const compact = pairRepositoryAt(4, COMPACT)

    expect(checkContract(written)).toEqual([])
    expect(checkContract(compact)).toEqual([])
    expect(
      formatChanges(diffContracts(contractAt(written), contractAt(compact))).split('\n'),
    ).toEqual([
      'contract changes: 4 flow lines added in sample.sign-in, 4 descriptions changed',
      'flow lines added in sample.sign-in: guard confirmationFollows: confirms follows, guard confirmationStrays: confirms strays, guard passwordBreaksRules: composite breaks, guard passwordsDiffer: confirms differs',
      'descriptions changed: sample.sign-in guard confirmationFollows 85 -> gone, sample.sign-in guard confirmationStrays 99 -> gone, sample.sign-in guard passwordBreaksRules 73 -> gone, sample.sign-in guard passwordsDiffer 56 -> gone',
    ])
  })
})

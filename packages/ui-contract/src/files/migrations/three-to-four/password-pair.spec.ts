import { describe, expect, it } from 'vitest'

import { screensOf, writtenBy } from '../documents.fixture'

import { writePasswordPairs } from './password-pair'

const FILE = 'password.yaml'

const HEAD = `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.password
title: "Password"
description: The new password, typed twice, with a long plain scalar that runs far past the eighty columns the yaml package folds at
entry: [ sample.password.form ]
anchors:
  sample.password.form:
    kind: form
`

const NEW_INPUT = `  sample.password.new-input:
    kind: input
    secret: true
    composite: password-rules
    description: The new password.
    binding: { action: platform.set-password, params: { password: sample.password.new-input } }
`

const AGAIN_INPUT = `  sample.password.again-input:
    kind: input
    secret: true
    description: The new password typed again; never sent.
`

const SUBMIT = `  sample.password.submit-button:
    kind: button
    binding: { action: platform.set-password }
`

const SENTENCES = {
  passwordBreaksRules: 'the password breaks one of the rules',
  passwordsDiffer: 'the password typed again is not the same as the password',
  confirmationStrays:
    '"the password typed again is no longer how the password begins: a character differs"',
  confirmationFollows: 'the password typed again is how the password begins, all of it or a part',
}

/** The flow, with the guards `entries` declares as `name: value` lines, and `meta` beside them. */
const flowWith = (entries: readonly string[], meta = ''): string =>
  `flow:\n  initial: weak\n  meta:\n${meta}    guards:\n${entries.map((entry) => `      ${entry}\n`).join('')}  states:\n    weak: {}\n`

const pairGuards = Object.entries(SENTENCES).map(([name, sentence]) => `${name}: ${sentence}`)
const OTHER = 'linkUnusable: { codes: [ link-invalid, link-expired ] }'

/** Runs the part over the one screen `text` and returns what it names and the text it writes. */
function written(text: string): { manual: string[]; text: string } {
  const texts = { [FILE]: text }
  const screens = screensOf(texts)
  const manual = writePasswordPairs(screens)

  return { manual, text: writtenBy(texts, screens)[FILE] ?? '' }
}

const PAIR = `${HEAD}${NEW_INPUT}${AGAIN_INPUT}${SUBMIT}`

describe('writePasswordPairs', () => {
  it('writes confirms on the confirmation and drops the four guards, keeping the others', () => {
    const result = written(`${PAIR}${flowWith([...pairGuards, OTHER])}`)

    expect(result.manual).toEqual([])
    expect(result.text).toBe(
      `${HEAD}${NEW_INPUT}${AGAIN_INPUT}    confirms: sample.password.new-input\n${SUBMIT}${flowWith([OTHER])}`,
    )
  })
  it('drops the guards the flow declares, however many of the four', () => {
    const result = written(`${PAIR}${flowWith([pairGuards[1] ?? '', pairGuards[3] ?? '', OTHER])}`)

    expect(result.text).toBe(
      `${HEAD}${NEW_INPUT}${AGAIN_INPUT}    confirms: sample.password.new-input\n${SUBMIT}${flowWith([OTHER])}`,
    )
  })
  it('drops the guards when they were all it declared, and its meta when they were all it held', () => {
    const only = written(`${PAIR}${flowWith(pairGuards)}`)

    expect(only.text).toBe(
      `${HEAD}${NEW_INPUT}${AGAIN_INPUT}    confirms: sample.password.new-input\n${SUBMIT}flow:\n  initial: weak\n  states:\n    weak: {}\n`,
    )

    const beside = written(
      `${PAIR}${flowWith(pairGuards, '    renders: [ sample.password.form ]\n')}`,
    )

    expect(beside.text).toBe(
      `${HEAD}${NEW_INPUT}${AGAIN_INPUT}    confirms: sample.password.new-input\n${SUBMIT}flow:\n  initial: weak\n  meta:\n    renders: [ sample.password.form ]\n  states:\n    weak: {}\n`,
    )
  })
  it('leaves a screen whose flow declares none of the four guards, as it is', () => {
    const text = `${PAIR}${flowWith([OTHER])}`

    expect(written(text)).toEqual({ manual: [], text })
    expect(written(`${PAIR}flow:\n  initial: weak\n  states:\n    weak: {}\n`).manual).toEqual([])
    expect(written(PAIR)).toEqual({ manual: [], text: PAIR })
  })
  it('only drops the guards of a screen that writes its confirms already', () => {
    const confirmed = `${HEAD}${NEW_INPUT}${AGAIN_INPUT}    confirms: sample.password.new-input\n${SUBMIT}`

    expect(written(`${confirmed}${flowWith(pairGuards)}`)).toEqual({
      manual: [],
      text: `${confirmed}flow:\n  initial: weak\n  states:\n    weak: {}\n`,
    })
  })
  it('finds nothing to do in what it wrote', () => {
    const first = written(`${PAIR}${flowWith([...pairGuards, OTHER])}`).text

    expect(written(first)).toEqual({ manual: [], text: first })
  })

  describe("where the confirmation is not the migration's to tell", () => {
    const named = Object.keys(SENTENCES).join(', ')
    const lines = (...texts: string[]): string[] =>
      texts.map(
        (text) =>
          `contract/domain/screens/password.yaml: ${named} name a password pair, ${text}: write \`confirms: <the input with the composite>\` on the confirmation and drop the guards by hand`,
      )
    const NO_CONFIRMATION =
      'and the screen has no one confirmation to tell: it needs exactly one secret input with a composite and exactly one other secret input with no binding'
    const flow = flowWith(pairGuards)

    it.each([
      [
        'two inputs with no binding',
        `${HEAD}${NEW_INPUT}${AGAIN_INPUT}${AGAIN_INPUT.replace('again', 'third')}${flow}`,
      ],
      [
        'no input with a composite',
        `${HEAD}${AGAIN_INPUT}${AGAIN_INPUT.replace('again', 'third')}${flow}`,
      ],
      [
        'two inputs with a composite',
        `${HEAD}${NEW_INPUT}${NEW_INPUT.replace('new-input', 'other-input')}${AGAIN_INPUT}${flow}`,
      ],
      ['no input with no binding', `${HEAD}${NEW_INPUT}${flow}`],
      ['an input that is both', `${HEAD}${NEW_INPUT.replace(/ {4}binding:.*\n/, '')}${flow}`],
      [
        'two confirmations',
        `${HEAD}${NEW_INPUT}${AGAIN_INPUT}    confirms: sample.password.new-input\n${AGAIN_INPUT.replace('again', 'third')}    confirms: sample.password.new-input\n${flow}`,
      ],
    ])('names the screen with %s, and leaves it', (_, text) => {
      expect(written(text)).toEqual({ manual: lines(NO_CONFIRMATION), text })
    })
    it('names the screen whose guard of those names is not a sentence, and leaves it', () => {
      const text = `${PAIR}${flowWith([...pairGuards.slice(0, 3), 'confirmationFollows: { codes: [ failed ] }'])}`

      expect(written(text)).toEqual({ manual: lines('but one of them is not a sentence'), text })
    })
  })
})

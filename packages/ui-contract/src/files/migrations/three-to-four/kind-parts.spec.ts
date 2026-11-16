import { describe, expect, it } from 'vitest'

import { screensOf, writtenBy } from '../documents.fixture'

import { dropKindParts } from './kind-parts'

const FILE = 'options.yaml'

const HEAD = `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.options
title: "Options"
description: A long plain scalar that runs far past the eighty columns the yaml package folds at, so that a rewrite of its node would fold it and break its line
entry: [ sample.options.page ]
anchors:
  sample.options.page:
    kind: page
`

const SELECT = `  sample.options.language-select:
    kind: select
    # the languages of the app
    description: 'The language of the screen.'
    binding: { model: thing.title }
`

const SECRET = `  sample.options.password-input:
    kind: input
    secret: true
    description: The password.
`

const DIALOG = `  sample.options.leave-dialog:
    kind: dialog
    description: Asks whether to leave.
`

/** Runs the part over the one screen `text` and returns what it names and the text it writes. */
function dropped(text: string): { manual: string[]; written: string } {
  const texts = { [FILE]: text }
  const screens = screensOf(texts)
  const manual = dropKindParts(screens)

  return { manual, written: writtenBy(texts, screens)[FILE] ?? '' }
}

describe('dropKindParts', () => {
  it("drops a select's data value and options, and only them", () => {
    const { manual, written } = dropped(
      `${HEAD}${SELECT}    dataValue: true\n    derived: [ option ]\n  sample.options.after:\n    kind: page\n`,
    )

    expect(manual).toEqual([])
    expect(written).toBe(`${HEAD}${SELECT}  sample.options.after:\n    kind: page\n`)
  })
  it("drops a secret input's visibility button, the two answers of a dialog and of a confirmation", () => {
    const confirmation = `  sample.options.delete-confirmation:\n    kind: confirmation\n    description: Asks before deleting.\n`
    const { manual, written } = dropped(
      `${HEAD}${SECRET}    derived: [ visibility-button ]\n${DIALOG}    derived: [ confirm-button, cancel-button ]\n${confirmation}    derived:\n      - confirm-button\n      - cancel-button\n`,
    )

    expect(manual).toEqual([])
    expect(written).toBe(`${HEAD}${SECRET}${DIALOG}${confirmation}`)
  })
  it('keeps the other suffixes of a list, and a list it did not empty', () => {
    const { written } = dropped(
      `${HEAD}${SELECT}    derived: [ option, size-select ]\n${DIALOG}    derived: [ cancel-button, other ]\n`,
    )

    expect(written).toBe(
      `${HEAD}${SELECT}    derived: [ size-select ]\n${DIALOG}    derived: [ other ]\n`,
    )
  })
  it('leaves what its kind does not imply: a data value on a badge, an input that is not secret, a list already empty', () => {
    const text = `${HEAD}  sample.options.role-badge:\n    kind: badge\n    dataValue: true\n  sample.options.email-input:\n    kind: input\n    derived: [ visibility-button ]\n${DIALOG}    derived: []\n`
    const { manual, written } = dropped(text)

    expect(manual).toEqual([])
    expect(written).toBe(text)
  })
  it("keeps a select's data value that is not true, and names its anchor", () => {
    const text = `${HEAD}${SELECT}    dataValue: false\n    derived: [ option ]\n`
    const { manual, written } = dropped(text)

    expect(manual).toEqual([
      'contract/domain/screens/options.yaml: sample.options.language-select: drop `dataValue`: a select always carries one, so it cannot be `false`',
    ])
    expect(written).toBe(`${HEAD}${SELECT}    dataValue: false\n`)
  })
  it('finds nothing to do in what it wrote', () => {
    const text = `${HEAD}${SELECT}    dataValue: true\n    derived: [ option ]\n${SECRET}    derived: [ visibility-button ]\n`
    const first = dropped(text).written

    expect(dropped(first)).toEqual({ manual: [], written: first })
  })
})

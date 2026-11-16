import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkContract, loadContract } from '../../check'
import { PLATFORM_FILE } from '../paths'
import { formatProblem } from '../problems'
import { parseYamlDocument } from '../read-yaml-document'

import { migrate } from './apply'
import { screensOf, writtenBy } from './documents.fixture'
import { fourToFive } from './four-to-five'
import { PANEL_FILE, writeVersionFourRepository } from './four-to-five.fixture'

const FILE = 'panel.yaml'

/** The screen of a panel with three parts, two of them with an error, and the regions `regions`. */
const panel = (
  regions: string,
): string => `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.panel
anchors:
  sample.panel.rename.save-button:
    kind: button
    binding: { action: platform.rename }
  sample.panel.rename.error:
    kind: error
  sample.panel.mail.send-button:
    kind: button
    binding: { action: platform.send }
  sample.panel.mail.error:
    kind: error
  sample.panel.ping.ping-button:
    kind: button
    binding: { action: platform.ping }
flow:
  initial: viewing
  states:
    viewing:
      type: parallel
      states:
${regions}`

/** The step run over the one screen `text`: what it writes, and what it leaves by hand. */
function migrated(text: string): { text: string; manual: readonly string[] } {
  const texts = { [FILE]: text }
  const screens = screensOf(texts)
  const manual = fourToFive.run({
    platform: parseYamlDocument('version: 4\n'),
    screens,
    vocabulary: '',
  })

  return { text: writtenBy(texts, screens)[FILE] ?? '', manual }
}

/** The text with the lines `removed` taken out, each once. */
const without = (text: string, removed: readonly string[]): string =>
  removed.reduce((rest, line) => rest.replace(`${line}\n`, ''), text)

const RENAME = `        rename:
          # renaming, under its own error
          by: sample.panel.rename.save-button
          description: "Renaming: the name is the one typed."
          onDone:
            description: The name is kept.
            actions:
              - clear: sample.panel.rename.error
              - read: sample.panel.section
`

describe('the migration from version 4 to 5', () => {
  it('steps from version 4', () => {
    expect(fourToFive.from).toBe(4)
  })

  it("drops a clear of the part's error that a branch of a button region's outcome writes first", () => {
    const text = panel(RENAME)

    expect(migrated(text)).toEqual({
      text: without(text, ['              - clear: sample.panel.rename.error']),
      manual: [],
    })
  })

  it('drops it from every branch, in either form, and the actions it leaves empty', () => {
    const text = panel(`        mail:
          by: sample.panel.mail.send-button
          onDone:
            - guard: queued
              read: false
              actions: [ { clear: sample.panel.mail.error } ]
            - description: Sent.
              actions:
                - type: clear
                  params: { anchor: sample.panel.mail.error }
                - read: sample.panel.section
        rename:
          by: sample.panel.rename.save-button
          onDone: { actions: [ { clear: sample.panel.rename.error } ] }
`)

    expect(migrated(text)).toEqual({
      text: without(text, [
        '              actions: [ { clear: sample.panel.mail.error } ]',
        '                - type: clear',
        '                  params: { anchor: sample.panel.mail.error }',
      ]).replace('onDone: { actions: [ { clear: sample.panel.rename.error } ] }', 'onDone: {}'),
      manual: [],
    })
  })

  it('keeps a clear the loader would not write there, and names one it refuses', () => {
    const text = panel(`        rename:
          by: sample.panel.rename.save-button
          onDone:
            actions:
              - read: sample.panel.section
              - clear: sample.panel.rename.error
        mail:
          by: sample.panel.mail.send-button
          onDone:
            - guard: late
              actions:
                - clear: sample.panel.mail.error
                - show: { sample.panel.mail.error: [ mail-late ] }
            - actions:
                - clear: sample.panel.rename.error
        ping:
          by: sample.panel.ping.ping-button
          onDone:
            actions:
              - clear: sample.panel.mail.error
          onError:
            actions:
              - show: sample.panel.mail.error
        written:
          initial: idle
          states:
            idle:
              on:
                sample.panel.rename.save-button: running
            running:
              invoke:
                src: platform.rename
                onDone:
                  target: idle
                  actions:
                    - clear: sample.panel.rename.error
`)

    expect(migrated(text)).toEqual({
      text,
      manual: [
        `contract/domain/screens/${FILE}: flow.states.viewing.states.rename.onDone.actions[1]: clear: sample.panel.rename.error after another effect, which version 5 derives as the first one and refuses written: drop it by hand`,
      ],
    })
  })

  it('leaves a screen with no region written by its button as it is, and a region whose button runs two actions', () => {
    const text = panel(`        rename:
          initial: idle
          states:
            idle: {}
`)

    expect(migrated(text)).toEqual({ text, manual: [] })

    const two = panel(RENAME).replace(
      '    binding: { action: platform.rename }',
      '    binding: [ { action: platform.rename }, { action: platform.send } ]',
    )

    expect(migrated(two)).toEqual({ text: two, manual: [] })
  })

  it('drops the first of two clears of the error and names the other where it is left', () => {
    const text = panel(`        rename:
          by: sample.panel.rename.save-button
          onDone:
            actions:
              - clear: sample.panel.rename.error
              - read: sample.panel.section
              - clear: sample.panel.rename.error
`)

    expect(migrated(text)).toEqual({
      text: text.replace('              - clear: sample.panel.rename.error\n', ''),
      manual: [
        `contract/domain/screens/${FILE}: flow.states.viewing.states.rename.onDone.actions[1]: clear: sample.panel.rename.error after another effect, which version 5 derives as the first one and refuses written: drop it by hand`,
      ],
    })
  })

  it('changes nothing on a second run', () => {
    const once = migrated(panel(RENAME)).text

    expect(migrated(once)).toEqual({ text: once, manual: [] })
  })
})

describe('the migration from version 4 to 5 on a repository', () => {
  const roots: string[] = []

  /** A new repository at version 4 whose button regions clear their errors, the mail's `later`. */
  function repository(later = false): string {
    const root = mkdtempSync(join(tmpdir(), 'ui-contract-four-to-five-'))

    roots.push(root)
    writeVersionFourRepository(root, later)

    return root
  }

  const read = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')

  /** The screens as loaded, every description left out. */
  const asLoaded = (root: string): unknown =>
    JSON.parse(
      JSON.stringify(loadContract(root).contract?.screens.screens, (key, value: unknown) =>
        key === 'description' ? undefined : value,
      ),
    )

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('starts from a contract that passes the check at version 4, its regions clearing their errors', () => {
    const root = repository()

    expect(checkContract(root).map(formatProblem)).toEqual([])
    expect(read(root, PANEL_FILE)).toContain('- clear: sample.panel.mail.error')
    expect(read(root, PANEL_FILE)).toContain('{ clear: sample.panel.rename.error }')
  })

  it('writes a contract at version 5 that loads as before and passes the check, writing no clear it derives', () => {
    const written = repository()
    const moved = repository()
    const panel = read(moved, PANEL_FILE)

    expect(migrate(moved, { write: true })).toEqual({
      from: 4,
      to: 5,
      steps: [
        { from: 4, note: fourToFive.note, files: [PANEL_FILE, PLATFORM_FILE].sort(), manual: [] },
      ],
    })
    expect(read(moved, PANEL_FILE)).toBe(
      without(panel, ['              - clear: sample.panel.mail.error']).replace(
        'onDone: { actions: [ { clear: sample.panel.rename.error } ] }',
        'onDone: {}',
      ),
    )
    expect(loadContract(moved).problems).toEqual([])
    expect(loadContract(moved).contract?.screens.version).toBe(5)
    expect(checkContract(moved).map(formatProblem)).toEqual([])
    expect(asLoaded(moved)).toEqual(asLoaded(written))
    expect(migrate(moved, { write: true })).toEqual({ from: 5, to: 5, steps: [] })
  })

  it('keeps a clear after another effect, names it, and the check refuses it at its place', () => {
    const root = repository(true)
    const panel = read(root, PANEL_FILE)
    const { steps } = migrate(root, { write: true })
    const at = 'flow.states.viewing.states.mail.onDone.actions[1]'

    expect(steps.flatMap(({ manual }) => manual)).toEqual([
      `${PANEL_FILE}: ${at}: clear: sample.panel.mail.error after another effect, which version 5 derives as the first one and refuses written: drop it by hand`,
    ])
    expect(read(root, PANEL_FILE)).toBe(
      panel.replace('onDone: { actions: [ { clear: sample.panel.rename.error } ] }', 'onDone: {}'),
    )
    expect(loadContract(root).problems.map(formatProblem)).toEqual([
      `${PANEL_FILE}:1: ${at}: derived: a success clears its area's error, sample.panel.mail.error; leave it out`,
    ])
  })
})

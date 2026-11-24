import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CONTRACT_VERSION } from '../../anchors'
import { loadContract } from '../../check'
import { writeContractRepository } from '../../contract-repository.fixture'
import { filesUnder } from '../files-under'
import { PLATFORM_FILE, SCREENS_DIR, VOCABULARY_FILE } from '../paths'
import { parseYamlDocument } from '../read-yaml-document'

import { migrate } from './apply'
import type { Migration } from './migration'
import { oneToTwo } from './one-to-two'
import { MIGRATIONS } from './registry'

/** The registry and the engine's version as they stood when version 2 came: 1 -> 2 alone. */
const TO_TWO = { migrations: [oneToTwo], current: 2 } as const

const SAMPLE = 'sample/$key.yaml'
const SAMPLE_FILE = `${SCREENS_DIR}/${SAMPLE}`

let root: string

const read = (file: string): string => readFileSync(join(root, file), 'utf8')

const write = (file: string, text: string): void => {
  writeFileSync(join(root, file), text)
}

/** Every file of the repository with its text, by its path. */
const snapshot = (): Map<string, string> =>
  new Map((filesUnder(root) ?? []).map((file) => [file, read(file)]))

/**
 * The fixture repository at version 1, whatever version its files have moved to since: the
 * platform declares 1 and the vocabulary says `Contract version: 1` under its title.
 */
function writeAtVersionOne(): void {
  writeContractRepository(root)
  write(PLATFORM_FILE, read(PLATFORM_FILE).replace(/^version: \d+$/m, 'version: 1'))
  write(
    VOCABULARY_FILE,
    read(VOCABULARY_FILE)
      .replace(/^Contract version: \d+\n\n?/m, '')
      .replace('# Vocabulary\n\n', '# Vocabulary\n\nContract version: 1\n\n'),
  )
}

/** A migration from `from` that sets the title of the sample screen and asks for a check by hand. */
const titling = (from: number): Migration => ({
  from,
  note: `the title moves on at ${from}`,
  run: (files) => {
    files.screens.get(SAMPLE)?.set('title', `Titled at ${from}`)

    return [`read the title of ${SAMPLE}`]
  },
})

/** The numbers of the lines `after` writes otherwise than `before`, both of one length. */
function changedLines(before: string, after: string): number[] {
  const lines = after.split('\n')

  expect(lines).toHaveLength(before.split('\n').length)

  return before.split('\n').flatMap((line, index) => (line === lines[index] ? [] : [index + 1]))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-migrate-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('MIGRATIONS', () => {
  it('steps from version 1 up to the version of this engine, one migration a version, in order', () => {
    expect(MIGRATIONS.map(({ from }) => from)).toEqual(
      Array.from({ length: CONTRACT_VERSION - 1 }, (_, index) => index + 1),
    )
  })
})

describe('migrate', () => {
  it('reports the step from version 1 to 2 and writes nothing without write', () => {
    writeAtVersionOne()

    const before = snapshot()

    expect(migrate(root, { write: false, ...TO_TWO })).toEqual({
      from: 1,
      to: 2,
      steps: [
        { from: 1, note: oneToTwo.note, files: [PLATFORM_FILE, VOCABULARY_FILE], manual: [] },
      ],
    })
    expect(snapshot()).toEqual(before)
  })
  it('rewrites a contract at version 1 into one at version 2 that loads', () => {
    writeAtVersionOne()

    const written = loadContract(root)

    expect(written.problems).toEqual([])
    expect(written.contract?.screens.version).toBe(1)
    expect(written.contract?.vocabulary.version).toBe(1)

    migrate(root, { write: true, ...TO_TWO })

    const moved = loadContract(root)

    expect(moved.problems).toEqual([])
    expect(moved.contract?.screens.version).toBe(2)
    expect(moved.contract?.vocabulary.version).toBeUndefined()
  })
  it('finds nothing to do in a contract it moved, and writes nothing', () => {
    writeAtVersionOne()
    migrate(root, { write: true, ...TO_TWO })

    const moved = snapshot()

    expect(migrate(root, { write: true, ...TO_TWO })).toEqual({ from: 2, to: 2, steps: [] })
    expect(snapshot()).toEqual(moved)
  })
  it('refuses a contract newer than this engine', () => {
    writeAtVersionOne()
    write(
      PLATFORM_FILE,
      read(PLATFORM_FILE).replace('version: 1', `version: ${TO_TWO.current + 1}`),
    )

    expect(() => migrate(root, { write: true, ...TO_TWO })).toThrow(
      `the contract is at version ${TO_TWO.current + 1}, newer than this engine, which reads up to version ${TO_TWO.current}`,
    )
  })
  it('refuses a platform file that declares no version', () => {
    writeAtVersionOne()
    write(PLATFORM_FILE, read(PLATFORM_FILE).replace('version: 1', 'version: one'))

    expect(() => migrate(root, { write: false, ...TO_TWO })).toThrow(
      `${PLATFORM_FILE} declares no version`,
    )
  })
  it('refuses a file that is not YAML, naming it', () => {
    writeAtVersionOne()
    write(SAMPLE_FILE, `${read(SAMPLE_FILE)}\n  title: [ broken\n`)

    expect(() => migrate(root, { write: false, ...TO_TWO })).toThrow(`${SAMPLE_FILE}: not YAML: `)
  })
  it('refuses a version no migration steps from, writing nothing of the steps before', () => {
    writeAtVersionOne()

    const before = snapshot()

    expect(() => migrate(root, { write: true, migrations: [], current: 2 })).toThrow(
      'no migration from version 1 to 2',
    )
    expect(() => migrate(root, { write: true, migrations: [titling(1)], current: 3 })).toThrow(
      'no migration from version 2 to 3',
    )
    expect(snapshot()).toEqual(before)
  })
  it('changes no byte of the platform file but its version line', () => {
    writeAtVersionOne()

    const text = [
      '# yaml-language-server: $schema=../schemas/platform.schema.json',
      'version: 1',
      `long: ${'word '.repeat(59)}words`,
      'quoted: "a quoted: string"',
      "single: 'a single-quoted string'",
      '',
      '# a comment of its own line',
      'list: [ a, b ]',
      'map: { k: v }',
      '',
    ].join('\n')

    expect(text.split('\n')[2]).toHaveLength('long: '.length + 300)

    write(PLATFORM_FILE, text)
    migrate(root, { write: true, ...TO_TWO })

    expect(changedLines(text, read(PLATFORM_FILE))).toEqual([2])
    expect(read(PLATFORM_FILE)).toBe(text.replace('\nversion: 1\n', '\nversion: 2\n'))
  })
  it('keeps the spacing of a property it leaves alone in the platform file it moves', () => {
    writeAtVersionOne()

    const text = read(PLATFORM_FILE).replace(
      '  anchor: app-shell.status\n',
      '  anchor:    app-shell.status\n',
    )

    expect(text).toContain('  anchor:    app-shell.status\n')
    expect(parseYamlDocument(text).toString({ lineWidth: 0 })).not.toBe(text)

    write(PLATFORM_FILE, text)

    expect(loadContract(root).problems).toEqual([])

    migrate(root, { write: true, ...TO_TWO })

    expect(read(PLATFORM_FILE)).toBe(text.replace(/^version: 1$/m, 'version: 2'))
    expect(loadContract(root).problems).toEqual([])
  })
  it('keeps the spacing of a property it leaves alone in a screen file a step changes', () => {
    writeAtVersionOne()

    const text = read(SAMPLE_FILE).replace(
      'description: The one thing',
      'description:    The one thing',
    )

    expect(text).toContain('description:    The one thing')
    expect(parseYamlDocument(text).toString({ lineWidth: 0 })).not.toBe(text)

    write(SAMPLE_FILE, text)
    migrate(root, { write: true, migrations: [titling(1)], current: 2 })

    expect(read(SAMPLE_FILE)).toBe(text.replace('title: One thing, edited', 'title: Titled at 1'))
  })
  it('leaves a screen file no step changes as written, even one YAML would write otherwise', () => {
    writeAtVersionOne()

    const text = read(SAMPLE_FILE).replace('title: One thing, edited', 'title:   One thing, edited')

    expect(text).toContain('title:   One')
    expect(parseYamlDocument(text).toString({ lineWidth: 0 })).not.toBe(text)

    write(SAMPLE_FILE, text)
    migrate(root, { write: true, ...TO_TWO })

    expect(read(SAMPLE_FILE)).toBe(text)
  })
  it('names the screen file a step changes with the work it leaves by hand, and rewrites it', () => {
    writeAtVersionOne()

    const text = read(SAMPLE_FILE)

    expect(migrate(root, { write: true, migrations: [titling(1)], current: 2 })).toEqual({
      from: 1,
      to: 2,
      steps: [
        {
          from: 1,
          note: 'the title moves on at 1',
          files: [PLATFORM_FILE, SAMPLE_FILE],
          manual: [`read the title of ${SAMPLE}`],
        },
      ],
    })
    expect(read(SAMPLE_FILE)).toBe(text.replace('title: One thing, edited', 'title: Titled at 1'))
  })
  it('steps through every version up to the engine, setting the version after each step', () => {
    writeAtVersionOne()

    const report = migrate(root, { write: true, migrations: [titling(1), titling(2)], current: 3 })

    expect(report.from).toBe(1)
    expect(report.to).toBe(3)
    expect(report.steps.map(({ from, files }) => ({ from, files }))).toEqual([
      { from: 1, files: [PLATFORM_FILE, SAMPLE_FILE] },
      { from: 2, files: [PLATFORM_FILE, SAMPLE_FILE] },
    ])
    expect(read(PLATFORM_FILE)).toContain('\nversion: 3\n')
    expect(read(SAMPLE_FILE)).toContain('\ntitle: Titled at 2\n')
  })
})

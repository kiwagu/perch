import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkContract, loadContract } from '../../check'
import { MODEL_FILE, PLATFORM_FILE } from '../paths'
import { formatProblem } from '../problems'
import { parseYamlDocument } from '../read-yaml-document'
import { writeDefaultsRepository } from '../values/defaults.fixture'
import { writeYamlDocument } from '../write-yaml-document'

import { migrate } from './apply'
import { fiveToSix } from './five-to-six'

/** The version this step writes, the engine's when it came: a later step is a spec of its own. */
const SIX = 6

/** A platform at version 5 that declares `defaults` (none for `null`) and the values `values`. */
const platform = (defaults: number | null, values: string): string =>
  `# yaml-language-server: $schema=../schemas/platform.schema.json
version: 5
${defaults === null ? '' : `defaults:\n  maxLength: ${defaults}\n`}values:
${values}reserved: [ app-shell.status ]
`

const VALUES = `  name:
    type: string
    minLength: 1
    maxLength: 80
    description: A name.
  code:
    type: string
    maxLength: 12
    description: "A code: short."
  size:
    type: string
    enum: [ small, large ]
    maxLength: 80
    description: A size.
  count:
    type: integer
    maxLength: 80
    description: A count.
  label: { type: string, maxLength: 80, description: A label. }
  password:
    type: string
    minLength: 1
    description: A password as the account has it now.
  token: { type: string, pattern: "^[a-z]+$" }
`

const MODEL = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "thing": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "x-perch": { "crdt": "text" }
        },
        "note": { "type": "string", "maxLength": 80 },
        "text": { "type": "string", "x-perch": { "crdt": "text" } },
        "author": { "type": "string", "maxLength": 80, "x-perch": { "readonly": true } },
        "size": { "enum": ["small", "large"], "maxLength": 80 },
        "body": { "type": "string", "maxLength": 2000 }
      }
    }
  }
}
`

/** The step run over `platformText` and `modelText`: what each writes, and what it leaves by hand. */
function migrated(platformText: string, modelText: string = MODEL) {
  const document = parseYamlDocument(platformText)
  const files = { platform: document, screens: new Map(), vocabulary: '', model: modelText }
  const manual = fiveToSix.run(files)

  return { platform: writeYamlDocument(platformText, document), model: files.model, manual }
}

describe('the migration from version 5 to 6', () => {
  it('steps from version 5', () => {
    expect(fiveToSix.from).toBe(5)
  })

  it('drops from the values a limit equal to the default that a value would take, and no other', () => {
    const text = platform(80, VALUES)

    expect(migrated(text).platform).toBe(
      text
        .replace('    minLength: 1\n    maxLength: 80\n', '    minLength: 1\n')
        .replace(
          '{ type: string, maxLength: 80, description: A label. }',
          '{ type: string, description: A label. }',
        )
        .replace(
          '    minLength: 1\n    description: A password',
          '    minLength: 1\n    maxLength: null\n    description: A password',
        )
        .replace(
          '{ type: string, pattern: "^[a-z]+$" }',
          '{ type: string, maxLength: null, pattern: "^[a-z]+$" }',
        ),
    )
  })

  it('keeps a value that names no limit without one: `maxLength: null`, before its pattern or description', () => {
    const text = platform(80, VALUES)

    expect(text).not.toContain('maxLength: null')
    expect(migrated(text).platform).toContain(
      '  password:\n    type: string\n    minLength: 1\n    maxLength: null\n    description:',
    )
  })

  it('names each field of the model that names no limit, which takes the default from then on', () => {
    expect(migrated(platform(80, VALUES)).manual).toEqual([
      `${MODEL_FILE}: $defs.thing.properties.text: names no limit, and from version 6 takes the default length, 80: write its own \`maxLength\` where that is too short`,
    ])
  })

  it('drops from the model a limit equal to the default on a writable string field, its comma with it', () => {
    expect(migrated(platform(80, VALUES)).model).toBe(
      MODEL.replace('          "maxLength": 80,\n', '').replace(
        '"note": { "type": "string", "maxLength": 80 }',
        '"note": { "type": "string" }',
      ),
    )
  })

  it('changes nothing without a default', () => {
    const text = platform(null, VALUES)

    expect(migrated(text)).toEqual({ platform: text, model: MODEL, manual: [] })
  })

  it('drops no limit of another number than the default', () => {
    const { platform: written, model } = migrated(platform(81, VALUES))

    expect(written.match(/maxLength: 80/g)).toHaveLength(4)
    expect(model).toBe(MODEL)
  })
})

describe('the migration from version 5 to 6 on a repository', () => {
  const roots: string[] = []

  function repository(defaults?: number): string {
    const root = mkdtempSync(join(tmpdir(), 'ui-contract-five-to-six-'))

    roots.push(root)
    writeDefaultsRepository(root, {
      version: 5,
      ...(defaults === undefined ? {} : { defaults }),
      name: 80,
      title: 80,
    })

    return root
  }

  const read = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')

  /** The values and the model's fields as loaded, every description left out. */
  const asLoaded = (root: string): unknown => {
    const { contract } = loadContract(root)

    return JSON.parse(
      JSON.stringify(
        { values: contract?.screens.platform.values, model: contract?.model.entities },
        (key, value: unknown) => (key === 'description' ? undefined : value),
      ),
    )
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes a contract at version 6 that loads every value as before and passes the check', () => {
    const written = repository(80)
    const moved = repository(80)
    const platformText = read(moved, PLATFORM_FILE)
    const modelText = read(moved, MODEL_FILE)

    expect(migrate(moved, { write: true, current: SIX })).toEqual({
      from: 5,
      to: 6,
      steps: [{ from: 5, note: fiveToSix.note, files: [MODEL_FILE, PLATFORM_FILE], manual: [] }],
    })
    expect(read(moved, PLATFORM_FILE)).toBe(
      platformText
        .replace('version: 5', 'version: 6')
        .replace('    minLength: 1\n    maxLength: 80\n', '    minLength: 1\n')
        .replace(
          '    minLength: 1\n    description: A password',
          '    minLength: 1\n    maxLength: null\n    description: A password',
        ),
    )
    expect(read(moved, MODEL_FILE)).toBe(modelText.replace('          "maxLength": 80,\n', ''))
    expect(loadContract(moved).contract?.screens.version).toBe(6)
    expect(checkContract(moved).map(formatProblem)).toEqual([])
    expect(asLoaded(moved)).toEqual(asLoaded(written))

    // A second run finds nothing to do: the step runs from version 5 alone.
    const once = [read(moved, PLATFORM_FILE), read(moved, MODEL_FILE)]

    expect(migrate(moved, { write: true, current: SIX })).toEqual({ from: 6, to: 6, steps: [] })
    expect([read(moved, PLATFORM_FILE), read(moved, MODEL_FILE)]).toEqual(once)
  })

  it('only moves the version of a contract with no default, and the check keeps its limits', () => {
    const root = repository()
    const modelText = read(root, MODEL_FILE)

    expect(migrate(root, { write: true, current: SIX }).steps).toEqual([
      { from: 5, note: fiveToSix.note, files: [PLATFORM_FILE], manual: [] },
    ])
    expect(read(root, MODEL_FILE)).toBe(modelText)
    expect(checkContract(root).map(formatProblem)).toEqual([])
  })
})

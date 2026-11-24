import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkContract, loadContract } from '../../check'
import { MODEL_FILE, PLATFORM_FILE } from '../paths'
import { formatProblem } from '../problems'
import { parseYamlDocument } from '../read-yaml-document'
import { parameterValueOf } from '../values'
import { writeDefaultsRepository } from '../values/defaults.fixture'
import { writeYamlDocument } from '../write-yaml-document'

import { migrate } from './apply'
import { fiveToSix } from './five-to-six'

/** The version this step writes, the engine's when it came: a later step is a spec of its own. */
const SIX = 6

/**
 * A platform at version 5 that declares `defaults` (none for `null`), the values `values` and the
 * actions `actions`.
 */
const platform = (defaults: number | null, values: string, actions = ''): string =>
  `# yaml-language-server: $schema=../schemas/platform.schema.json
version: 5
${defaults === null ? '' : `defaults:\n  maxLength: ${defaults}\n`}values:
${values}${actions}reserved: [ app-shell.status ]
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

/** Actions whose parameters write their string inline: each shape a step must tell apart. */
const ACTIONS = `actions:
  sign-out:
    params:
      reason: { type: string, minLength: 1, optional: true, description: Why. }
      note: { type: string, pattern: "^[a-z]+$", optional: true, description: A note. }
      detail: { type: string, minLength: 1, maxLength: 20, optional: true, description: Detail. }
      same: { type: string, minLength: 1, maxLength: 80, optional: true, description: The default. }
      bare: { type: string, optional: true, description: Bare. }
      kind: { type: string, enum: [ a, b ], optional: true, description: Kind. }
      amount: { type: integer, minimum: 1, optional: true, description: Amount. }
      title: { value: name, optional: true, description: Title. }
  rename:
    params:
      label: { type: string, format: email, optional: true, description: A label. }
`

/** Actions as a version 5 platform may write them: one in the older forms, one in the newer. */
const BEHAVIOUR = `actions:
  sign-in:
    result: ${'a'.repeat(201)}
    codes: [ failed, rate-limited ]
  sign-out:
    result: [ the device is signed out ]
    codes: { failed: the device is offline }
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

  it('names each inline parameter that writes a constraint and no limit, with its path and the default', () => {
    expect(migrated(platform(80, VALUES, ACTIONS)).manual).toEqual([
      `${MODEL_FILE}: $defs.thing.properties.text: names no limit, and from version 6 takes the default length, 80: write its own \`maxLength\` where that is too short`,
      `${PLATFORM_FILE}: actions["sign-out"].params.reason: names no limit, and from version 6 takes the default length, 80: write its own \`maxLength\` where that is too short, or refer to a named value (\`value: <name>\`) that writes \`maxLength: null\``,
      `${PLATFORM_FILE}: actions["sign-out"].params.note: names no limit, and from version 6 takes the default length, 80: write its own \`maxLength\` where that is too short, or refer to a named value (\`value: <name>\`) that writes \`maxLength: null\``,
      `${PLATFORM_FILE}: actions.rename.params.label: names no limit, and from version 6 takes the default length, 80: write its own \`maxLength\` where that is too short, or refer to a named value (\`value: <name>\`) that writes \`maxLength: null\``,
    ])
  })

  it('names each action whose codes are a list and each result of one string past the budget, default or none', () => {
    for (const defaults of [80, null]) {
      expect(
        migrated(platform(defaults, VALUES, BEHAVIOUR)).manual.filter((line) =>
          line.startsWith(`${PLATFORM_FILE}: actions`),
        ),
      ).toEqual([
        `${PLATFORM_FILE}: actions["sign-in"].codes: a list of codes, and from version 6 an action's codes are a map: write when each answers, \`<code>: <condition>\`, or \`<code>: { invariant: <name> }\` for a rule several actions keep`,
        `${PLATFORM_FILE}: actions["sign-in"].result: one string of 201 characters, and from version 6 it keeps the budget of 200: write it as outcome lines within the budget, a refusal as its code's condition`,
      ])
    }
  })

  it('names the default the platform declares, and no parameter of a contract with none', () => {
    const named = (defaults: number | null) =>
      migrated(platform(defaults, VALUES, ACTIONS)).manual.filter((line) =>
        line.includes('.params.'),
      )

    expect(named(81)).toHaveLength(3)
    expect(named(81).every((line) => line.includes('takes the default length, 81:'))).toBe(true)
    expect(named(null)).toEqual([])
  })

  it('leaves every parameter as written', () => {
    const text = platform(80, VALUES, ACTIONS)

    expect(migrated(text).platform).toContain(ACTIONS)
  })

  it('drops from the model a limit equal to the default on a writable string field, its comma with it', () => {
    expect(migrated(platform(80, VALUES)).model).toBe(
      MODEL.replace('          "maxLength": 80,\n', '').replace(
        '"note": { "type": "string", "maxLength": 80 }',
        '"note": { "type": "string" }',
      ),
    )
  })

  it.each([
    ['an object', '"x-perch": { "crdt": "text", "tags": { "kinds": [1, 2] } }'],
    ['a one-line array', '"examples": ["a", "b"]'],
    ['a multi-line array', '"examples": [\n            "a",\n            "b"\n          ]'],
    ['a multi-line object', '"x-perch": {\n            "crdt": "text"\n          }'],
  ])(
    'drops a limit that is the last member after %s, its comma with it, and a second run changes nothing',
    (_after, member) => {
      const model = `{
  "$defs": {
    "thing": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          ${member},
          "maxLength": 80
        },
        "note": { "type": "string", ${member.replace(/\n\s*/g, ' ')}, "maxLength": 80 },
        "body": { "type": "string", "maxLength": 2000 }
      }
    }
  }
}
`
      const once = migrated(platform(80, VALUES), model).model

      expect(once).toBe(
        model.replace(
          /,(\s*)"maxLength": 80(\s*)\}/g,
          (_match, _gap, close: string) => `${close}}`,
        ),
      )
      const kept: unknown = JSON.parse(`{ "type": "string", ${member} }`)

      expect(JSON.parse(once)).toEqual({
        $defs: {
          thing: {
            type: 'object',
            properties: {
              title: kept,
              note: kept,
              body: { type: 'string', maxLength: 2000 },
            },
          },
        },
      })
      expect(migrated(platform(80, VALUES), once).model).toBe(once)
    },
  )

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

  function repository(defaults?: number, reason?: string): string {
    const root = mkdtempSync(join(tmpdir(), 'ui-contract-five-to-six-'))

    roots.push(root)
    writeDefaultsRepository(root, {
      version: 5,
      ...(defaults === undefined ? {} : { defaults }),
      ...(reason === undefined ? {} : { reason }),
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

  it('migrates a model whose limit is the last member of a field after an object', () => {
    const root = repository(80)
    const ordered = read(root, MODEL_FILE).replace(
      '"maxLength": 80,\n          "x-perch": { "crdt": "text" }',
      '"x-perch": { "crdt": "text" },\n          "maxLength": 80',
    )

    expect(ordered).not.toBe(read(root, MODEL_FILE))
    writeFileSync(join(root, MODEL_FILE), ordered)

    expect(migrate(root, { write: true, current: SIX }).steps).toHaveLength(1)
    expect(read(root, MODEL_FILE)).toBe(ordered.replace(',\n          "maxLength": 80', ''))
    expect(checkContract(root).map(formatProblem)).toEqual([])

    const once = [read(root, PLATFORM_FILE), read(root, MODEL_FILE)]

    expect(migrate(root, { write: true, current: SIX })).toEqual({ from: 6, to: 6, steps: [] })
    expect([read(root, PLATFORM_FILE), read(root, MODEL_FILE)]).toEqual(once)
  })

  describe('an inline parameter that gains the default', () => {
    const INLINE = '{ type: string, minLength: 1, optional: true, description: Why. }'
    const reasonOf = (root: string) => {
      const { contract } = loadContract(root)

      if (contract === undefined) {
        throw new Error('the contract does not load')
      }

      return parameterValueOf(
        'platform.sign-out',
        'reason',
        contract.screens.platform,
        contract.model,
      )
    }

    it('is named as manual work, and is the one the loaded contract bounds from version 6', () => {
      const root = repository(80, INLINE)
      const platformText = read(root, PLATFORM_FILE)

      expect(reasonOf(root)).toEqual({ type: 'string', minLength: 1 })

      const { steps } = migrate(root, { write: true, current: SIX })

      expect(steps.map(({ manual }) => manual)).toEqual([
        [
          `${PLATFORM_FILE}: actions["sign-out"].params.reason: names no limit, and from version 6 takes the default length, 80: write its own \`maxLength\` where that is too short, or refer to a named value (\`value: <name>\`) that writes \`maxLength: null\``,
        ],
      ])
      expect(read(root, PLATFORM_FILE)).toBe(
        platformText
          .replace('version: 5', 'version: 6')
          .replace('    minLength: 1\n    maxLength: 80\n', '    minLength: 1\n')
          .replace(
            '    minLength: 1\n    description: A password',
            '    minLength: 1\n    maxLength: null\n    description: A password',
          ),
      )
      expect(reasonOf(root)).toEqual({ type: 'string', minLength: 1, maxLength: 80 })
      expect(checkContract(root).map(formatProblem)).toEqual([])
    })

    it('is named by a dry run as well, and names nothing once the author writes the limit', () => {
      expect(
        migrate(repository(80, INLINE), { write: false, current: SIX }).steps[0]?.manual,
      ).toHaveLength(1)

      const limited = repository(
        80,
        '{ type: string, minLength: 1, maxLength: 20, optional: true, description: Why. }',
      )

      expect(migrate(limited, { write: true, current: SIX }).steps[0]?.manual).toEqual([])
      expect(reasonOf(limited).maxLength).toBe(20)
    })

    it.each([
      ['a `minLength`', '{ type: string, minLength: 1, optional: true, description: Why. }', true],
      [
        'a `pattern`',
        '{ type: string, pattern: "^[a-z]+$", optional: true, description: Why. }',
        true,
      ],
      ['a `format`', '{ type: string, format: email, optional: true, description: Why. }', true],
      [
        'its own limit',
        '{ type: string, minLength: 1, maxLength: 20, optional: true, description: Why. }',
        false,
      ],
      [
        'the default as its limit',
        '{ type: string, minLength: 1, maxLength: 80, optional: true, description: Why. }',
        false,
      ],
      ['no constraint', '{ type: string, optional: true, description: Why. }', false],
      ['an `enum`', '{ type: string, enum: [ a, b ], optional: true, description: Why. }', false],
      ['a number', '{ type: integer, minimum: 1, optional: true, description: Why. }', false],
      ['a value it refers to', '{ value: name, optional: true, description: Why. }', false],
    ])(
      'names a parameter with %s exactly when version 6 loads it with a limit version 5 did not',
      (_shape, reason, gains) => {
        const root = repository(80, reason)
        const before = reasonOf(root).maxLength

        const manual = migrate(root, { write: true, current: SIX }).steps[0]?.manual ?? []
        const after = reasonOf(root).maxLength

        expect(before === undefined && after !== undefined).toBe(gains)
        expect(manual.filter((line) => line.includes('.params.reason'))).toHaveLength(gains ? 1 : 0)
      },
    )
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

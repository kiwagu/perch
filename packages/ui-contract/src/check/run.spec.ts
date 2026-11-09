import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeContractRepository } from '../contract-repository.fixture'
import {
  activityFile,
  formatProblem,
  MODEL_FILE,
  PLATFORM_FILE,
  readDescriptions,
  SCREEN_SCHEMA_FILE,
  scenarioFile,
  VOCABULARY_FILE,
} from '../files'

import { checkContract, loadContract } from './run'

const ROOT = join(import.meta.dirname, '../../../..')
const SCENARIO = 'sample/base/thing'
const ACTIVITY = 'thing'

let root: string

const printed = (): string[] => checkContract(root).map(formatProblem)

const edit = (file: string, change: (text: string) => string): void => {
  const path = join(root, file)

  writeFileSync(path, change(readFileSync(path, 'utf8')))
}

/** `text` with the last `from` in it written as `to`. */
const lastReplaced = (text: string, from: string, to: string): string => {
  const at = text.lastIndexOf(from)

  return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-check-'))
  writeContractRepository(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkContract', () => {
  it('finds nothing in the contract of the repository, nor in the fixture', () => {
    expect(checkContract(ROOT).map(formatProblem)).toEqual([])
    expect(printed()).toEqual([])
  })
  it('stops at the problems of loading, sorted by file and line', () => {
    rmSync(join(root, MODEL_FILE))
    edit(VOCABULARY_FILE, (text) =>
      text.replace('## Roles', '## Roles\n\n## Roles').replace('## Kinds', '## Kind list'),
    )
    edit(PLATFORM_FILE, (text) => text.replace('version: 1', 'version: one'))
    edit(scenarioFile(SCENARIO), (text) => text.replace('  A: member', '  a: member'))
    edit(activityFile(ACTIVITY), (text) => text.replace('id: thing', 'id: things'))

    expect(printed()).toEqual([
      'contract/domain/activities/thing.yaml:1: its id is "things", so its file is contract/domain/activities/things.yaml',
      'contract/domain/model.schema.json:1: cannot read the file',
      'contract/domain/platform.yaml:1: version: Invalid input: expected 1',
      'contract/vocabulary.md:1: missing section "Kinds"',
      'contract/vocabulary.md:9: unknown section "Kind list"',
      'contract/vocabulary.md:77: section "Roles" appears twice',
      'tests/e2e/scenarios/sample/base/thing.md:5: devices.a: Invalid key in record',
    ])
  })
  it('runs every rule and the schema drift once the files load', () => {
    edit(VOCABULARY_FILE, (text) =>
      text.replace('| `saved` |', '| `spare` | `sample.save-button` | a spare code |\n| `saved` |'),
    )
    edit(SCREEN_SCHEMA_FILE, (text) => `${text}\n`)

    expect(printed()).toEqual([
      'contract/schemas/screen.schema.json:1: differs from its Zod source; run `bun run contract:schemas`',
      'contract/vocabulary.md:1: code "spare" is documented but unused',
    ])
  })
  it('holds the activities to the screens they visit', () => {
    edit(activityFile(ACTIVITY), (text) => lastReplaced(text, '/sample/$key', '/sample/$other'))

    expect(printed()).toEqual([
      'contract/domain/activities/thing.yaml:18: states.editing.on["sample.save-button"]: "sample.save-button" leads to "/sample/$other" through neither a navigate of the flow of "sample" nor a link',
      'contract/domain/activities/thing.yaml:24: states.saved.meta.address.path: "/sample/$other" is the path of no binding of "sample"',
    ])
  })
  it('refuses a derived anchor whose base does not list the suffix', () => {
    edit(scenarioFile(SCENARIO), (text) =>
      text.replace('[sample.title-input]', '[sample.title-input.confirm-button]'),
    )

    expect(printed()).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:18: steps[1]: [sample.title-input.confirm-button] is not a declared anchor',
    ])
  })
  it('refuses a notice whose link carries a search: a notice carries no token', () => {
    const notice = (link: string): string =>
      `    codes:\n      - failed\n    notices:\n      - name: signed-out\n        to: account\n        language: account\n        link: ${link}\n`

    edit(PLATFORM_FILE, (text) =>
      text.replace('    codes:\n      - failed\n', notice('{ screen: sample }')),
    )

    expect(printed()).toEqual([
      'contract/domain/platform.yaml:1: actions["sign-out"].notices[0].link.screen: the route "/sample/$key" of "sample" needs a parameter, and a notice\'s link carries none',
    ])

    edit(PLATFORM_FILE, (text) =>
      text.replace('{ screen: sample }', '{ screen: sample, search: key }'),
    )

    expect(printed()).toEqual([
      'contract/domain/platform.yaml:1: actions["sign-out"].notices[0].link: Unrecognized key: "search"',
    ])
  })
  it('refuses a permission role of the model that the vocabulary does not list', () => {
    edit(MODEL_FILE, (text) => text.replace('"member": { "create"', '"memebr": { "create"'))

    expect(printed()).toEqual([
      'contract/domain/model.schema.json:1: $defs.thing["x-perch"].can.memebr: "memebr" is not a role of the vocabulary',
    ])
  })
  it('loads the descriptions as the domain files write them', () => {
    const { contract } = loadContract(root)

    expect(contract?.descriptions).toEqual(readDescriptions(root).descriptions)
    expect(contract?.descriptions.map(({ place }) => place)).toContain('sample.page')
  })
  it('holds every written description to its budget, at its line in its file', () => {
    edit('contract/domain/screens/sample/$key.yaml', (text) =>
      text.replace('The root of the screen.', `The root${' of the screen'.repeat(14)}.`),
    )
    edit(MODEL_FILE, (text) => text.replace('Adds a thing.', `Adds${' a thing'.repeat(25)}.`))

    expect(printed().map((problem) => problem.replace(/; its purpose: .*$/, ''))).toEqual([
      'contract/domain/model.schema.json:16: $defs.thing["x-perch"].actions.createThing.description: the description of model action thing.createThing is 205 characters, past its budget of 200',
      'contract/domain/screens/sample/$key.yaml:11: anchors["sample.page"].description: the description of sample.page is 205 characters, past its budget of 200',
    ])
  })
})

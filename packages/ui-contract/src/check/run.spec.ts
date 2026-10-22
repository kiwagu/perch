import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  activityFile,
  formatProblem,
  MODEL_FILE,
  PLATFORM_FILE,
  SCENARIOS_DIR,
  SCREEN_SCHEMA_FILE,
  scenarioFile,
  VOCABULARY_FILE,
} from '../files'

import { checkContract } from './run'

const ROOT = join(import.meta.dirname, '../../../..')

let root: string

const printed = (): string[] => checkContract(root).map(formatProblem)

const edit = (file: string, change: (text: string) => string): void => {
  const path = join(root, file)

  writeFileSync(path, change(readFileSync(path, 'utf8')))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-check-'))
  cpSync(join(ROOT, 'contract'), join(root, 'contract'), { recursive: true })
  cpSync(join(ROOT, SCENARIOS_DIR), join(root, SCENARIOS_DIR), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkContract', () => {
  it('finds nothing in the contract of the repository', () => {
    expect(checkContract(ROOT).map(formatProblem)).toEqual([])
  })
  it('stops at the problems of loading, sorted by file and line', () => {
    rmSync(join(root, MODEL_FILE))
    edit(VOCABULARY_FILE, (text) =>
      text.replace('## Roles', '## Roles\n\n## Roles').replace('## Kinds', '## Kind list'),
    )
    edit(PLATFORM_FILE, (text) => text.replace('version: 1', 'version: one'))
    edit(scenarioFile('user/base/sign-up'), (text) => text.replace('  A: guest', '  a: guest'))
    edit(activityFile('session'), (text) => text.replace('id: session', 'id: sessions'))

    expect(printed()).toEqual([
      'contract/activities/session.yaml:1: its id is "sessions", so its file is contract/activities/sessions.yaml',
      'contract/model.schema.json:1: cannot read the file',
      'contract/platform.yaml:1: version: Invalid input: expected 1',
      'contract/vocabulary.md:1: missing section "Kinds"',
      expect.stringMatching(/^contract\/vocabulary\.md:\d+: unknown section "Kind list"$/),
      expect.stringMatching(/^contract\/vocabulary\.md:\d+: section "Roles" appears twice$/),
      'tests/e2e/scenarios/user/base/sign-up.md:5: devices.a: Invalid key in record',
    ])
  })
  it('runs every rule and the schema drift once the files load', () => {
    edit(VOCABULARY_FILE, (text) =>
      text.replace(
        '| `no-notes` |',
        '| `spare` | `organisation.notes.empty-message` | a spare code |\n| `no-notes` |',
      ),
    )
    edit(SCREEN_SCHEMA_FILE, (text) => `${text}\n`)

    expect(printed()).toEqual([
      'contract/screen.schema.json:1: differs from its Zod source; run `bun run contract:schemas`',
      'contract/vocabulary.md:1: code "spare" is documented but unused',
    ])
  })
  it('holds the activities of the repository to the screens they visit', () => {
    edit(activityFile('session'), (text) =>
      text.replace('address: { path: /devices }', 'address: { path: /device }'),
    )

    expect(printed()).toEqual([
      'contract/activities/session.yaml:28: states.profile.on["app-shell.nav.devices-link"]: "app-shell.nav.devices-link" leads to "/device" through neither a navigate of the flow of "app-shell" nor a link',
      'contract/activities/session.yaml:42: states.devices.meta.address.path: "/device" is the path of no binding of "device"',
    ])
  })
  it('refuses a derived anchor of the repository whose base does not list the suffix', () => {
    edit(scenarioFile('user/base/edit-profile-name'), (text) =>
      text.replace(
        'Click [user.profile.save-button]',
        'Click [user.profile.save-button.confirm-button]',
      ),
    )

    expect(printed()).toEqual([
      'tests/e2e/scenarios/user/base/edit-profile-name.md:19: steps[3]: [user.profile.save-button.confirm-button] is not a declared anchor',
    ])
  })
  it('refuses a permission role of the model that the vocabulary does not list', () => {
    edit(MODEL_FILE, (text) => text.replace('"member": { "create"', '"memebr": { "create"'))

    expect(printed()).toEqual([
      'contract/model.schema.json:1: $defs.note["x-perch"].can.memebr: "memebr" is not a role of the vocabulary',
    ])
  })
})

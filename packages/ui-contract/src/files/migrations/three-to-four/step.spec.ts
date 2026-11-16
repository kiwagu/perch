import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkContract, loadContract } from '../../../check'
import { LANDING_FILE } from '../../derive/mail-links.fixture'
import { filesUnder } from '../../files-under'
import { PLATFORM_FILE } from '../../paths'
import { formatProblem } from '../../problems'
import { migrate } from '../apply'

import { threeToFour } from './index'
import { ACCOUNT_FILE, writeVersionThreeRepository } from './three-to-four.fixture'

const KEY_BY_HAND =
  "write `x-perch.key: <code>` on a search parameter that is the screen's key, where no `mail.link` derives it"

const roots: string[] = []

/** A new repository at version 3, with the screens that write what version 4 derives. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-three-to-four-'))

  roots.push(root)
  writeVersionThreeRepository(root)

  return root
}

const read = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')

/** Every file of the repository with its text, by its path. */
const snapshot = (root: string): Map<string, string> =>
  new Map((filesUnder(root) ?? []).map((file) => [file, read(root, file)]))

/** The text with the lines `removed` taken out, each once. */
function without(text: string, removed: readonly string[]): string {
  return removed.reduce((rest, line) => rest.replace(`${line}\n`, ''), text)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('the migration from version 3 to 4', () => {
  it('steps from version 3', () => {
    expect(threeToFour.from).toBe(3)
  })
  it('starts from a contract that passes the check at version 3, writing what version 4 derives', () => {
    const root = repository()

    expect(checkContract(root).map(formatProblem)).toEqual([])

    const account = read(root, ACCOUNT_FILE)

    for (const written of [
      'dataValue: true',
      'derived: [ option ]',
      'visibility-button',
      'confirm-button',
      'roles: [ member ]',
      'passwordsDiffer:',
    ]) {
      expect(account).toContain(written)
    }

    expect(read(root, LANDING_FILE)).toContain('token:')
  })
  it('names the files it changes without writing them, leaving the key by hand', () => {
    const root = repository()
    const before = snapshot(root)

    expect(migrate(root, { write: false })).toEqual({
      from: 3,
      to: 4,
      steps: [
        {
          from: 3,
          note: threeToFour.note,
          files: [ACCOUNT_FILE, LANDING_FILE, PLATFORM_FILE].sort(),
          manual: [KEY_BY_HAND],
        },
      ],
    })
    expect(snapshot(root)).toEqual(before)
  })
  it('writes a contract at version 4 that loads and passes the check, writing nothing the engine derives', () => {
    const root = repository()

    migrate(root, { write: true })

    expect(loadContract(root).problems).toEqual([])
    expect(loadContract(root).contract?.screens.version).toBe(4)
    expect(checkContract(root).map(formatProblem)).toEqual([])
  })
  it('changes the account screen by the lines of what it drops and the one it writes, and no other byte', () => {
    const root = repository()
    const before = read(root, ACCOUNT_FILE)

    migrate(root, { write: true })

    const guards = [
      'passwordBreaksRules',
      'passwordsDiffer',
      'confirmationStrays',
      'confirmationFollows',
    ]

    expect(read(root, ACCOUNT_FILE)).toBe(
      without(before, [
        '    dataValue: true',
        '    derived: [ option ]',
        '    derived: [ confirm-button, cancel-button ]',
        '    roles: [ member ]',
        ...before
          .split('\n')
          .filter((line) => guards.some((guard) => line.startsWith(`      ${guard}: `))),
      ])
        .replaceAll('    derived: [ visibility-button ]\n', '')
        .replace(
          '    description: The new password typed again; never sent.\n',
          '    description: The new password typed again; never sent.\n    confirms: sample.account.password-input\n',
        )
        .replace('  meta:\n    guards:\n', ''),
    )
  })
  it("drops the landing's token parameter and its empty search, and the version in the platform file, and nothing else", () => {
    const root = repository()
    const platform = read(root, PLATFORM_FILE)
    const landing = read(root, LANDING_FILE)

    migrate(root, { write: true })

    expect(read(root, PLATFORM_FILE)).toBe(platform.replace('version: 3', 'version: 4'))
    expect(read(root, LANDING_FILE)).toBe(landing.replace(/ {4}search:\n( {6}.*\n)+/, ''))
  })
  it('finds nothing to do in a contract it moved', () => {
    const root = repository()

    migrate(root, { write: true })

    const moved = snapshot(root)

    expect(migrate(root, { write: true })).toEqual({ from: 4, to: 4, steps: [] })
    expect(snapshot(root)).toEqual(moved)
  })
  it('loads the migrated contract as it loaded before, but for the key, the guards and the confirmation the loader derives', () => {
    const written = repository()
    const moved = repository()

    migrate(moved, { write: true })

    const asLoaded = (root: string): unknown =>
      JSON.parse(
        JSON.stringify(loadContract(root).contract?.screens.screens, (key, value: unknown) =>
          ['confirms', 'x-perch', 'guards'].includes(key) ? undefined : value,
        ),
      )

    expect(asLoaded(moved)).toEqual(asLoaded(written))
  })
  it('names a screen with a password pair it cannot tell, and leaves its guards, the rest of the screen moving on', () => {
    const root = repository()
    const unclear = read(root, ACCOUNT_FILE).replace('    composite: password-rules\n', '')

    writeFileSync(join(root, ACCOUNT_FILE), unclear)

    const { steps } = migrate(root, { write: true })
    const moved = read(root, ACCOUNT_FILE)

    expect(steps.flatMap(({ manual }) => manual)).toEqual([
      `${ACCOUNT_FILE}: passwordBreaksRules, passwordsDiffer, confirmationStrays, confirmationFollows name a password pair, and the screen has no one confirmation to tell: it needs exactly one secret input with a composite and exactly one other secret input with no binding: write \`confirms: <the input with the composite>\` on the confirmation and drop the guards by hand`,
      KEY_BY_HAND,
    ])
    expect(moved).toContain('passwordsDiffer: ')
    expect(moved).not.toContain('confirms:')
    expect(moved).not.toContain('visibility-button')
    expect(loadContract(root).problems).toEqual([])
  })
})

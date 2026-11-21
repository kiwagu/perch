import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadScreens } from '@workspace/ui-contract'

import { heldLeaves, leavesAtBase, leavesOf } from './held-leaves'

/**
 * The fields the app's navigating controls are held to lose: the contract's now, or on a branch
 * the base's for a control the app still lists as the base derived it, so a business commit that
 * adds a field to a screen with a leaving control does not fail the leave spec before the app
 * follows; anything the app lists beyond either contract still fails.
 */

const ROOT = join(import.meta.dirname, '../../../../..')

const roots: string[] = []

const isGitVariable = (name: string): boolean => name.startsWith('GIT_')

// Inside a git hook `GIT_DIR` and `GIT_INDEX_FILE` name the real repository, which the engine's
// reads of a ref would take for the sample.
beforeEach(() => {
  for (const name of Object.keys(process.env).filter(isGitVariable)) {
    vi.stubEnv(name, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(root: string, ...args: string[]): void {
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid']

  execFileSync('git', [...identity, ...args], { cwd: root, stdio: 'ignore', env: process.env })
}

/** A repository whose commit tagged `base` holds the repository's own contract. */
function sample(): string {
  const root = mkdtempSync(join(tmpdir(), 'held-leaves-'))

  roots.push(root)

  for (const folder of ['contract', 'tests/e2e/scenarios']) {
    cpSync(join(ROOT, folder), join(root, folder), { recursive: true })
  }

  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'base')
  git(root, 'tag', 'base')

  return root
}

const LINK = 'user.sign-in.forgot-link'
const BEFORE = ['user.sign-in.name-input', 'user.sign-in.password-input']
const AFTER = ['user.sign-in.code.code-input', ...BEFORE]
const OTHER = 'console.users.list.open-link'

describe('heldLeaves', () => {
  it('holds every control as the contract says it now, without the ahead mode', () => {
    const now = { [LINK]: AFTER, [OTHER]: ['console.users.search-input'] }

    expect(
      heldLeaves({ app: { [LINK]: BEFORE }, now, base: { [LINK]: BEFORE }, ahead: false }),
    ).toEqual(now)
  })

  it('holds a control the app lists as the base derived it to the base, in the ahead mode', () => {
    expect(
      heldLeaves({
        app: { [LINK]: BEFORE },
        now: { [LINK]: AFTER },
        base: { [LINK]: BEFORE },
        ahead: true,
      }),
    ).toEqual({ [LINK]: BEFORE })
  })

  it('holds a control the app lists as the contract has it now to now, in the ahead mode', () => {
    expect(
      heldLeaves({
        app: { [LINK]: AFTER },
        now: { [LINK]: AFTER },
        base: { [LINK]: BEFORE },
        ahead: true,
      }),
    ).toEqual({ [LINK]: AFTER })
  })

  it('holds a control the app lists as neither contract derives it to now, in the ahead mode', () => {
    const listed = ['user.sign-in.password-input']

    expect(
      heldLeaves({
        app: { [LINK]: listed },
        now: { [LINK]: AFTER },
        base: { [LINK]: BEFORE },
        ahead: true,
      }),
    ).toEqual({ [LINK]: AFTER })
  })

  it('lets a control the app does not list yet wait, in the ahead mode', () => {
    expect(heldLeaves({ app: {}, now: { [LINK]: AFTER }, base: {}, ahead: true })).toEqual({})
  })

  it('never holds a control the contract does not have, so the app listing one fails', () => {
    const app = { [LINK]: BEFORE, [OTHER]: ['console.users.search-input'] }
    const held = heldLeaves({ app, now: { [LINK]: BEFORE }, base: app, ahead: true })

    expect(held).toEqual({ [LINK]: BEFORE })
    expect(app).not.toEqual(held)
  })
})

describe('leavesAtBase', () => {
  it('reads nothing without the ahead mode or a base', () => {
    for (const env of [
      {},
      { CONTRACT_AHEAD: '1' },
      { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: '' },
    ]) {
      expect(leavesAtBase(ROOT, env)).toEqual({})
    }
  })

  it('reads the leaves of the contract at the base in the ahead mode', () => {
    const root = sample()
    const { screens } = loadScreens(root)
    const atBase = leavesAtBase(root, { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'base' })

    expect(atBase).toEqual(leavesOf(screens?.screens ?? []))
    expect(atBase[LINK]).toContain('user.sign-in.password-input')
  })

  it('fails when the base names no commit', () => {
    const root = sample()

    expect(() =>
      leavesAtBase(root, { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'nowhere' }),
    ).toThrow('"nowhere" names no commit')
  })
})

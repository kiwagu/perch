import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadContract } from '../check'
import { PLATFORM_FILE } from '../files'
import { contractAt } from '../handoff'
import { git, repository, useRepositories } from '../repository.fixture'

import { writeEmitRepository } from './emit.fixture'
import { heldModule } from './held-module'
import { valuesModuleOf } from './values'

/**
 * `heldModule` holds an emitted module to the contract of the working tree, or, while the contract
 * runs ahead of the app, to the contract at the branch's merge base with `main` or at the commit
 * the branch is at. The repository is the sample contract in three states: a base commit, a head
 * commit that raises the default length, and a working tree that raises it again, so each state
 * emits another module; a commit before them holds no contract.
 */

useRepositories()

interface History {
  readonly root: string
  readonly atBase: string
  readonly atHead: string
  readonly now: string
}

/** Commits what the repository holds as `name`, and tags it so a revision can name it. */
function commit(root: string, name: string): void {
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '--allow-empty', '-m', name)
  git(root, 'tag', name)
}

/** Writes the default length the platform declares, which the module of every value takes. */
function raiseDefaultTo(root: string, length: number): void {
  const file = join(root, PLATFORM_FILE)
  const text = readFileSync(file, 'utf8')
  const raised = text.replace(/defaults:\n {2}maxLength: \d+/, `defaults:\n  maxLength: ${length}`)

  if (raised === text) {
    throw new Error(`${PLATFORM_FILE} does not write a default length to raise`)
  }

  writeFileSync(file, raised)
}

const moduleAt = (revision: string, root: string): string => {
  const contract = contractAt(revision, root)

  if ('missing' in contract) {
    throw new Error(`${revision} holds no contract`)
  }

  return valuesModuleOf(contract)
}

function history(): History {
  const root = repository({})

  commit(root, 'first')
  writeEmitRepository(root, { version: 6, defaults: 80 })
  commit(root, 'base')
  raiseDefaultTo(root, 81)
  commit(root, 'head')
  raiseDefaultTo(root, 82)

  const { contract } = loadContract(root)

  if (contract === undefined) {
    throw new Error('the sample does not load')
  }

  return {
    root,
    atBase: moduleAt('base', root),
    atHead: moduleAt('head', root),
    now: valuesModuleOf(contract),
  }
}

const AHEAD = { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'base', CONTRACT_AHEAD_HEAD: 'head' }

const held = (
  { root }: History,
  committed: string,
  env: Readonly<Record<string, string | undefined>>,
): string => heldModule({ committed, emit: valuesModuleOf, root, env })

describe('heldModule', () => {
  it('has another module at each state of the sample', () => {
    const { atBase, atHead, now } = history()

    expect(new Set([atBase, atHead, now]).size).toBe(3)
  })

  describe('without the ahead mode', () => {
    it('is what the contract of the working tree emits', () => {
      const sample = history()

      expect(held(sample, sample.now, {})).toBe(sample.now)
      expect(held(sample, sample.atHead, {})).toBe(sample.now)
      expect(held(sample, sample.atHead, {})).not.toBe(sample.atHead)
    })

    it('reads no earlier contract while the mode is not set', () => {
      const sample = history()
      const { CONTRACT_AHEAD: _mode, ...revisions } = AHEAD

      expect(held(sample, sample.atBase, revisions)).toBe(sample.now)
      expect(held(sample, sample.atBase, { ...revisions, CONTRACT_AHEAD: '0' })).toBe(sample.now)
    })
  })

  describe('in the ahead mode', () => {
    it.each([
      ['the working tree', ({ now }: History) => now],
      ['the base', ({ atBase }: History) => atBase],
      ['the head', ({ atHead }: History) => atHead],
    ])('takes a module of %s as it is', (_, of) => {
      const sample = history()

      expect(held(sample, of(sample), AHEAD)).toBe(of(sample))
    })

    it('holds a module that none of the three emitted to the working tree', () => {
      const sample = history()
      const stale = `${sample.atBase}// edited by hand\n`

      expect(held(sample, stale, AHEAD)).toBe(sample.now)
      expect(held(sample, stale, AHEAD)).not.toBe(stale)
    })

    it('takes nothing from a revision that is not named', () => {
      const sample = history()
      const headOnly = { ...AHEAD, CONTRACT_AHEAD_BASE: '' }

      expect(held(sample, sample.atBase, headOnly)).toBe(sample.now)
      expect(held(sample, sample.atHead, headOnly)).toBe(sample.atHead)
    })

    it('takes nothing from a commit that holds no contract', () => {
      const sample = history()
      const none = { ...AHEAD, CONTRACT_AHEAD_BASE: 'first' }

      expect(held(sample, sample.atBase, none)).toBe(sample.now)
      expect(held(sample, sample.atHead, none)).toBe(sample.atHead)
    })

    it('refuses a base that names no commit, unless the module is the one of the working tree', () => {
      const sample = history()
      const lost = { ...AHEAD, CONTRACT_AHEAD_BASE: 'nowhere' }

      expect(() => held(sample, sample.atHead, lost)).toThrow('"nowhere" names no commit')
      expect(held(sample, sample.now, lost)).toBe(sample.now)
    })
  })

  it('refuses a contract of the working tree that does not load', () => {
    const sample = history()

    writeFileSync(join(sample.root, PLATFORM_FILE), 'version: [\n')

    expect(() => held(sample, sample.now, AHEAD)).toThrow('the contract does not load')
  })
})

/**
 * The contract at a git ref, for the hand-over diff: the contract files, the screen files, the
 * activities and the scenarios as that commit holds them, loaded as the check loads them.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { type Contract, loadContract } from '../check'
import {
  ACTIVITIES_DIR,
  CONTRACT_DIR,
  formatProblem,
  MODEL_FILE,
  PLATFORM_FILE,
  SCENARIOS_DIR,
  SCREENS_DIR,
  VOCABULARY_FILE,
} from '../files'

const FILES = [VOCABULARY_FILE, PLATFORM_FILE, MODEL_FILE] as const

/** The folders whose every file belongs to the contract, at any depth. */
const FOLDERS = [SCREENS_DIR, ACTIVITIES_DIR, SCENARIOS_DIR] as const

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Writes `file` as it is at `ref` into the folder `temp`. */
function copyAt(root: string, ref: string, file: string, temp: string): void {
  let text: string

  try {
    text = git(root, ['show', `${ref}:${file}`])
  } catch {
    throw new Error(`${ref} has no ${file}`)
  }

  mkdirSync(dirname(join(temp, file)), { recursive: true })
  writeFileSync(join(temp, file), text)
}

/**
 * The contract at `ref` of the repository at `root`, or `missing` when that commit has no
 * `contract/` folder. A ref that names no commit, and a contract there that does not load,
 * are errors.
 */
export function contractAt(ref: string, root: string): Contract | { missing: true } {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  } catch {
    throw new Error(`"${ref}" names no commit`)
  }

  if (git(root, ['ls-tree', '--name-only', ref, '--', `${CONTRACT_DIR}/`]).trim() === '') {
    return { missing: true }
  }

  const temp = mkdtempSync(join(tmpdir(), 'ui-contract-diff-'))

  try {
    const folders = FOLDERS.map((dir) => `${dir}/`)
    const listed = git(root, ['ls-tree', '-r', '--name-only', ref, '--', ...folders])
      .split('\n')
      .filter((file) => file !== '')

    for (const file of [...FILES, ...listed]) {
      copyAt(root, ref, file, temp)
    }

    const { contract, problems } = loadContract(temp)

    if (contract === undefined) {
      const printed = problems.map(formatProblem).join('; ')

      throw new Error(`the contract at ${ref} does not load: ${printed}`)
    }

    return contract
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/**
 * Temporary git repositories for the tests that read one. Every git call, the fixture's
 * and the code's under test, runs without the `GIT_*` variables the test inherited: inside
 * a git hook they point at the real repository (`GIT_INDEX_FILE`, `GIT_DIR`,
 * `GIT_WORK_TREE`), and a `git add` in the temporary one would write into its index.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, vi } from 'vitest'

const roots: string[] = []

const isGitVariable = (name: string): boolean => name.startsWith('GIT_')

/** The environment of the test without its `GIT_*` variables. */
const gitFree = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !isGitVariable(name)))

/** Runs `git` in `root` with an identity for its commits and nothing inherited from a hook. */
export function git(root: string, ...args: string[]): void {
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid']

  execFileSync('git', [...identity, ...args], { cwd: root, stdio: 'ignore', env: gitFree() })
}

/**
 * Registers the hooks of a spec that reads temporary repositories: each test runs without
 * the inherited `GIT_*` variables, and the repositories are removed after it.
 */
export function useRepositories(): void {
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
}

export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

/** A new repository with the given files, the ones under `staged` added to its index. */
export function repository(
  files: Readonly<Record<string, string>>,
  staged: readonly string[] = [],
): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-repository-'))

  roots.push(root)
  git(root, 'init', '--quiet')
  writeFiles(root, files)

  if (staged.length > 0) {
    git(root, 'add', '--', ...staged)
  }

  return root
}

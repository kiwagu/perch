/**
 * Pre-commit check for the landing branch. A commit on `main` lands a reviewed
 * branch, and it is accepted only when the whole database suites and the whole
 * end-to-end suites have passed on exactly the tree being committed.
 * `bun run test:db` and `CI=1 bun run test:e2e`, run without arguments, record
 * one receipt per tree under `.gates/` (a run given a spec or a filter records
 * none); this check looks the index tree up there. A landing that also stages a file of the
 * contract engine must pass `bun run contract:inflight` too: no branch in flight may break under
 * the engine it lands, and the refusal names the branches that would. The round is read from the
 * staged files against HEAD, which on `main` is what the landing adds. The check runs from the
 * working tree, so it runs only when every file it executes is the staged one: a file of those
 * (`CHECK_INPUTS`) that differs from the index, untracked ones included, refuses the landing
 * before the check runs, naming it. The check reads each branch by its name, so a branch another
 * checkout commits to while it runs could be read half before and half after that commit: the
 * local branch heads are read before the check and again after it, and a head that moved, was
 * made or was deleted in between refuses the landing, naming it, whatever the check answered. On
 * any other branch, or on a detached HEAD, the check does nothing. The branch is told by its full
 * ref, so a tag named `main` changes nothing, and a commit git cannot tell the branch, the staged
 * files, the working tree's differences or the local branches of fails.
 *
 * Usage: bun run scripts/gates/check-main-gates.ts [--branch <name>]
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { git, stagedFiles } from '../staged-commit.ts'

import { FULL_RUN_SCRIPT } from './full-run.ts'
import { GATES, headRef, indexTreeId, receiptPath, topLevel } from './tree.ts'

const LANDING_BRANCH = 'main'

const LANDING_REF = `refs/heads/${LANDING_BRANCH}`

/** The contract engine's folder: a round that stages a file in it may break a branch in flight. */
const ENGINE_DIR = 'packages/ui-contract'

/** The root script that loads the contract of every branch in flight with the engine at hand. */
const INFLIGHT_SCRIPT = 'contract:inflight'

const INFLIGHT_COMMAND = `bun run ${INFLIGHT_SCRIPT}`

/**
 * What the check executes, as paths from the top of the checkout: the engine and the workspace
 * package it imports, the `.surql` preload that bunfig.toml registers for every bun run, the root
 * manifest, its lockfile and the bun configuration, and this gate with every module it imports,
 * which run from the working tree as well (`scripts/gates` and the helper `staged-commit.ts`;
 * the spec reads the gate's imports and holds each module to this list).
 */
const CHECK_INPUTS = [
  ENGINE_DIR,
  'packages/zod',
  'packages/data/src',
  'bunfig.toml',
  'package.json',
  'bun.lock',
  'scripts/gates',
  'scripts/staged-commit.ts',
] as const

/**
 * Whether the commit lands: on the branch `--branch` names, or else on the branch HEAD is on,
 * told by its full ref; undefined when git cannot tell.
 */
function landing(argv: readonly string[]): boolean | undefined {
  const index = argv.indexOf('--branch')

  if (index !== -1) {
    return argv[index + 1] === LANDING_BRANCH
  }

  const ref = headRef()

  return ref === undefined ? undefined : ref === LANDING_REF
}

/** The branches the check's report heads with `<branch>: <n> problem(s)`, in its order. */
function brokenBranches(report: string): string[] {
  return report.split('\n').flatMap((line) => {
    const branch = /^(\S+): \d+ problems?$/.exec(line)?.[1]

    return branch === undefined ? [] : [branch]
  })
}

/** The paths of `-z` output from git, without the empty tail. */
const pathsOf = (out: string): string[] => out.split('\0').filter((path) => path !== '')

/**
 * The files of `CHECK_INPUTS` whose working tree differs from the index, a deleted one and an
 * untracked one (an ignored one not) included, in path order; undefined when git fails.
 */
function unstagedInputs(): string[] | undefined {
  const paths = CHECK_INPUTS.map((path) => `:/${path}`)
  const changed = git([
    'diff',
    '--name-only',
    '--no-renames',
    '--ignore-submodules=none',
    '-z',
    '--',
    ...paths,
  ])
  const untracked = git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '--full-name',
    '-z',
    '--',
    ...paths,
  ])

  if (changed.status !== 0 || untracked.status !== 0) {
    return undefined
  }

  return [...pathsOf(changed.out), ...pathsOf(untracked.out)].sort()
}

const HEADS = 'refs/heads/'

/** Every local branch by name, with the commit it points at; undefined when git fails. */
function branchHeads(): Map<string, string> | undefined {
  const { status, out } = git(['for-each-ref', '--format=%(objectname) %(refname)', HEADS])

  if (status !== 0) {
    return undefined
  }

  return new Map(
    out
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const space = line.indexOf(' ')

        return [line.slice(space + 1 + HEADS.length), line.slice(0, space)]
      }),
  )
}

/** The branches whose head differs between two readings, made and deleted ones included, by name. */
function movedBranches(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const names = new Set([...before.keys(), ...after.keys()])

  return [...names].filter((name) => before.get(name) !== after.get(name)).sort()
}

/**
 * Runs the check of the branches in flight and says why the landing is refused, as lines;
 * none when it passes. The check runs only when nothing it executes differs from the index, and
 * its answer counts only when no local branch head moved while it ran. A run that names no broken
 * branch (it did not finish, or failed) is refused as well, with what it printed.
 */
function inflightRefusal(): string[] {
  const unstaged = unstagedInputs()

  if (unstaged === undefined) {
    return ['gates: git cannot compare the working tree with the index.']
  }

  if (unstaged.length > 0) {
    return [
      `gates: this landing changes ${ENGINE_DIR}, and the working tree differs from the index in what the in-flight check runs, so it did not run:`,
      ...unstaged.map((path) => `  ${path}`),
      'gates: stage each, or restore it to the index (git restore, git clean), then commit again.',
    ]
  }

  const before = branchHeads()
  const run = spawnSync(process.execPath, ['run', '--silent', INFLIGHT_SCRIPT], {
    cwd: topLevel(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const after = branchHeads()

  if (before === undefined || after === undefined) {
    return ['gates: git cannot list the local branches.']
  }

  const lead = `gates: this landing changes ${ENGINE_DIR}, and`
  const moved = movedBranches(before, after)

  if (moved.length > 0) {
    return [
      `${lead} these branches moved while the in-flight check ran, so its answer may mix their commits:`,
      ...moved.map((branch) => `  ${branch}`),
      'gates: commit again: the check then runs on the branches as they stand.',
    ]
  }

  if (run.status === 0) {
    return []
  }

  const broken = brokenBranches(run.stdout)

  if (broken.length > 0) {
    return [
      `${lead} these branches in flight would break:`,
      ...broken.map((branch) => `  ${branch}`),
      `gates: \`${INFLIGHT_COMMAND}\` shows what breaks in each.`,
    ]
  }

  const how = run.status === null ? 'it did not finish' : `exit ${run.status}`
  const printed = `${run.stdout}${run.stderr}`.trimEnd().split('\n')

  return [
    `${lead} the in-flight check failed (${how}) without naming a branch:`,
    ...printed.map((line) => `  ${line}`),
    `gates: \`${INFLIGHT_COMMAND}\` runs it again.`,
  ]
}

function main(argv: readonly string[]): number {
  const lands = landing(argv)

  if (lands === undefined) {
    console.error('gates: git cannot tell the branch this commit is on.')

    return 1
  }

  if (!lands) {
    return 0
  }

  const files = stagedFiles()

  if (files === undefined) {
    console.error('gates: git cannot list the files this commit stages.')

    return 1
  }

  const treeId = indexTreeId()
  const missing = GATES.filter((gate) => !existsSync(receiptPath(gate, treeId)))
  const touchesEngine = files.some((file) => file.startsWith(`${ENGINE_DIR}/`))
  const refusal = touchesEngine ? inflightRefusal() : []

  if (missing.length === 0 && refusal.length === 0) {
    const checked = touchesEngine ? ' and no branch in flight breaks' : ''

    console.log(`gates: db and e2e suites passed on tree ${treeId}${checked}, landing allowed`)

    return 0
  }

  if (missing.length > 0) {
    console.error(`gates: a commit on ${LANDING_BRANCH} needs green suites on tree ${treeId}.`)
    console.error('gates: missing receipts:')

    for (const gate of missing) {
      console.error(
        `  ${gate}: run \`${FULL_RUN_SCRIPT[gate]}\` without arguments on this exact content, then commit again`,
      )
    }
  }

  for (const line of refusal) {
    console.error(line)
  }

  return 1
}

process.exit(main(process.argv.slice(2)))

/**
 * Refuses a commit while a git hook lefthook's configuration names is not installed in the clone.
 * lefthook installs the hooks on `lefthook install` (which `bun install` runs), and a hook run
 * installs them again by itself when it notices the configuration changed since (an edit in the
 * same second as the last install can pass unnoticed), unless told not to (`--no-auto-install`);
 * a hook whose file went while the configuration stayed the same stays missing, and every commit
 * of the clone would skip it, silently. The configuration is
 * lefthook's own reading of it (`lefthook dump`), a machine-local `lefthook-local.yml` included;
 * a hook is installed when git finds a file it can run where it looks for that hook
 * (`git rev-parse --git-path hooks/<name>`: the hooks folder every worktree of the clone shares,
 * or `core.hooksPath`).
 *
 * Usage: bun run scripts/hooks-installed.ts, as the first job of the pre-commit hook.
 */

import { spawnSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'

/** The hooks git runs (githooks(5)): the configuration's other keys are lefthook's own options. */
const GIT_HOOKS = new Set([
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-receive',
  'update',
  'proc-receive',
  'post-receive',
  'post-update',
  'reference-transaction',
  'push-to-checkout',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-prepare-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'post-index-change',
])

/** The hooks lefthook's configuration names, or undefined when lefthook cannot read it. */
function configured(): readonly string[] | undefined {
  const dump = spawnSync('lefthook', ['dump', '--format=json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (dump.status !== 0) {
    return undefined
  }

  try {
    const config: unknown = JSON.parse(dump.stdout)

    return typeof config === 'object' && config !== null
      ? Object.keys(config).filter((name) => GIT_HOOKS.has(name))
      : undefined
  } catch {
    return undefined
  }
}

/** Whether git finds a hook `name` it can run, or undefined when git cannot say where it looks. */
function installed(name: string): boolean | undefined {
  const where = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', `hooks/${name}`],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )

  if (where.status !== 0) {
    return undefined
  }

  const path = where.stdout.trim()

  try {
    accessSync(path, constants.X_OK)

    return statSync(path).isFile()
  } catch {
    return false
  }
}

function main(): number {
  const hooks = configured()

  if (hooks === undefined) {
    console.error('git hooks: lefthook cannot read its configuration (lefthook dump failed).')

    return 1
  }

  const states = hooks.map((name) => ({ name, installed: installed(name) }))

  if (states.some((state) => state.installed === undefined)) {
    console.error('git hooks: git cannot say where it looks for its hooks.')

    return 1
  }

  const missing = states.filter((state) => state.installed === false).map((state) => state.name)

  if (missing.length === 0) {
    return 0
  }

  console.error(
    [
      'git hooks: lefthook runs these hooks, and this clone has not installed them, so every commit would skip them:',
      ...missing.map((name) => `  ${name}`),
      'Install them, then commit again:',
      '  bunx lefthook install',
    ].join('\n'),
  )

  return 1
}

process.exit(main())

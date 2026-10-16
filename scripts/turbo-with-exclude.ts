/**
 * Runs a turbo task for every workspace except the excluded ones.
 *
 * Usage:
 *   bun run dev -- --exclude @workspace/web
 *   bun run scripts/turbo-with-exclude.ts dev -x a,b -- --log-order=grouped
 *
 * Names are workspace package names. Everything after `--` goes to turbo as is.
 */

import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'

const splitNames = (value: string): string[] =>
  value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

function parse(argv: readonly string[]): { excludes: string[]; rest: string[] } {
  const excludes: string[] = []
  const rest: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''

    if (arg === '--') {
      rest.push(...argv.slice(index + 1))

      break
    }

    if (arg === '--exclude' || arg === '-x') {
      excludes.push(...splitNames(argv[++index] ?? ''))
    } else if (arg.startsWith('--exclude=')) {
      excludes.push(...splitNames(arg.slice('--exclude='.length)))
    } else {
      rest.push(arg)
    }
  }

  return { excludes, rest }
}

const [task, ...argv] = process.argv.slice(2)

if (!task || task.startsWith('-')) {
  console.error('usage: turbo-with-exclude.ts <task> [--exclude a,b] [-x c] [-- turbo args]')
  process.exit(1)
}

const { excludes, rest } = parse(argv)
const args = ['run', task, ...excludes.map((name) => `--filter=!${name}`), ...rest]
const path = `${join(process.cwd(), 'node_modules', '.bin')}${delimiter}${process.env['PATH'] ?? ''}`
const result = spawnSync('turbo', args, { stdio: 'inherit', env: { ...process.env, PATH: path } })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)

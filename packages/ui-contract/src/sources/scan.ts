/**
 * The sources the contract check reads: the tracked and untracked (not ignored) `.ts` and
 * `.tsx` files under the web app and the UI kit, except tests, declarations, generated
 * files, fixtures and snapshots; each one collected by `collectFromSource`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Collected, collectFromSource } from './collect'

export const SOURCE_ROOTS = ['apps/web/src', 'packages/ui/src'] as const

const SOURCE = /\.tsx?$/
const EXCLUDED = /\.(spec|test)\.[^/]*$|\.d\.ts$|\.gen\.ts$|(^|\/)(__fixtures__|__snapshots__)\//

/** The repository paths of the sources under the roots, sorted. */
export function sourcePaths(root: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SOURCE_ROOTS],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  return [...new Set(output.split('\0'))]
    .filter((path) => SOURCE.test(path) && !EXCLUDED.test(path))
    .filter((path) => existsSync(join(root, path)))
    .sort()
}

export const scanSources = (root: string): Collected[] =>
  sourcePaths(root).map((path) => collectFromSource(readFileSync(join(root, path), 'utf8'), path))

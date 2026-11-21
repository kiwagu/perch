/**
 * The sources the contract check reads: the tracked and untracked (not ignored) `.ts` and
 * `.tsx` files under the web app and the UI kit, except tests, declarations, generated
 * files, fixtures and snapshots; each one collected by `collectFromSource`. Every `.ts` and `.tsx`
 * file under them, those left out included, is held to the module declarations it may write
 * (`augmentation.ts`): a test or a declaration could add to a source's types as well.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { augmentationProblems } from './augmentation'
import { type Collected, collectFromSource } from './collect'

export const SOURCE_ROOTS = ['apps/web/src', 'packages/ui/src'] as const

const SOURCE = /\.tsx?$/
const EXCLUDED = /\.(spec|test)\.[^/]*$|\.d\.ts$|\.gen\.ts$|(^|\/)(__fixtures__|__snapshots__)\//

/** The repository paths of the `.ts` and `.tsx` files under the roots, sorted. */
function typedPaths(root: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SOURCE_ROOTS],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  return [...new Set(output.split('\0'))]
    .filter((path) => SOURCE.test(path))
    .filter((path) => existsSync(join(root, path)))
    .sort()
}

/** The repository paths of the sources under the roots, sorted. */
export const sourcePaths = (root: string): string[] =>
  typedPaths(root).filter((path) => !EXCLUDED.test(path))

/** Each source collected, and each other typed file that writes a refused module declaration. */
export const scanSources = (root: string): Collected[] =>
  typedPaths(root).flatMap((path) => {
    const text = readFileSync(join(root, path), 'utf8')
    const augmenting = augmentationProblems(text, path)

    if (!EXCLUDED.test(path)) {
      const collected = collectFromSource(text, path)

      return [{ ...collected, problems: [...collected.problems, ...augmenting] }]
    }

    // A file the check does not collect has nothing else to say: an empty collection.
    return augmenting.length === 0 ? [] : [{ ...collectFromSource('', path), problems: augmenting }]
  })

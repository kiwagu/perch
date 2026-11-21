/**
 * The sources the contract check reads: the tracked and untracked (not ignored) `.ts` and
 * `.tsx` files under the web app and the UI kit, except tests, declarations, generated
 * files, fixtures and snapshots; each one collected by `collectFromSource`. Every typed file of
 * the repository git lists (`.ts`, `.tsx`, `.mts`, `.cts`, declarations, tests and the files of
 * any package or folder included; ignored build output and `node_modules` not) is held to the
 * module declarations it may write (`augmentation.ts`): any of them could add to a source's types
 * through a path, the web app's alias or a root's package. Only a file of a fixture project that
 * compiles alone is left out: one outside the web app and the UI kit whose nearest `tsconfig.json`
 * above it lies inside a `__fixtures__` folder, so its stand-in for a kit module reaches no view.
 * A fixture without such a tsconfig is compiled by its package's program or the repository's, and
 * a source's program may import it: it is read like any file, as is every fixture of the two
 * projects.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

import { augmentationProblems } from './augmentation'
import { type Collected, collectFromSource } from './collect'

export const SOURCE_ROOTS = ['apps/web/src', 'packages/ui/src'] as const

const SOURCE = /\.tsx?$/
const TYPED = /\.[cm]?tsx?$/
const EXCLUDED = /\.(spec|test)\.[^/]*$|\.d\.ts$|\.gen\.ts$|(^|\/)(__fixtures__|__snapshots__)\//

/** The projects whose programs hold the source roots: a fixture inside one is read like any file. */
const SOURCE_PROJECTS = ['apps/web/', 'packages/ui/'] as const

const FIXTURE = /(^|\/)__fixtures__\//

/**
 * Whether `path` is a file of a fixture project isolated from the source programs: outside the
 * source projects, with the nearest `tsconfig.json` above it inside a `__fixtures__` folder.
 */
function isolatedFixture(root: string, path: string): boolean {
  if (!FIXTURE.test(path) || SOURCE_PROJECTS.some((project) => path.startsWith(project))) {
    return false
  }

  for (let folder = posix.dirname(path); folder !== '.'; folder = posix.dirname(folder)) {
    if (existsSync(join(root, folder, 'tsconfig.json'))) {
      return FIXTURE.test(`${folder}/`)
    }
  }

  return false
}

/** The repository paths git lists under `under` (the whole repository for none) that `kind` takes. */
function listedPaths(root: string, kind: RegExp, under: readonly string[]): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...under],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  return [...new Set(output.split('\0'))]
    .filter((path) => kind.test(path))
    .filter((path) => existsSync(join(root, path)))
    .sort()
}

/** The repository paths of the sources under the roots, sorted. */
export const sourcePaths = (root: string): string[] =>
  listedPaths(root, SOURCE, SOURCE_ROOTS).filter((path) => !EXCLUDED.test(path))

/** Each source collected, and each typed file that writes a refused module declaration. */
export function scanSources(root: string): Collected[] {
  const read = (path: string): string => readFileSync(join(root, path), 'utf8')
  const refused = new Map(
    listedPaths(root, TYPED, [])
      .filter((path) => !isolatedFixture(root, path))
      .map((path) => [path, augmentationProblems(read(path), path, SOURCE_ROOTS)] as const)
      .filter(([, problems]) => problems.length > 0),
  )
  const sources = sourcePaths(root).map((path): Collected => {
    const collected = collectFromSource(read(path), path)

    return { ...collected, problems: [...collected.problems, ...(refused.get(path) ?? [])] }
  })
  const collected = new Set(sources.map(({ file }) => file))
  // A file the check does not collect has nothing else to say: an empty collection.
  const others = [...refused]
    .filter(([path]) => !collected.has(path))
    .map(([path, problems]): Collected => ({ ...collectFromSource('', path), problems }))

  return [...sources, ...others].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

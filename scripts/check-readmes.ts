/**
 * Every workspace package carries a short README that a reader can trust:
 *
 *   # <Title> (`<package name>`)
 *   ## Role in the architecture
 *   ## Key exports
 *   ## Commands
 *
 * and so does every feature module (a folder under `src/features/` of a workspace),
 * whose details belong to it rather than to its application's README:
 *
 *   # <Title> (module `<id>`)
 *   ## Role in the architecture
 *   ## Surface
 *   ## Commands
 *
 * The module id is the `id` of its `*.module.ts` manifest, or the folder name when the
 * folder has no manifest; support folders (`__fixtures__`, `__snapshots__`, dot folders)
 * are not modules. This check fails when a workspace or a module has no README.md, when
 * the title does not name it, when a manifest's id cannot be read, or when a section is
 * missing. Keeping
 * the content current is part of any change to a package's role, exports or scripts,
 * or to a module's routes, shapes, commands or providers.
 *
 * Usage: bun run scripts/check-readmes.ts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const SECTIONS = ['## Role in the architecture', '## Key exports', '## Commands']
const MODULE_SECTIONS = ['## Role in the architecture', '## Surface', '## Commands']
const SUPPORT_FOLDER = /^(__|\.)/

interface RootManifest {
  readonly workspaces: { readonly packages: readonly string[] }
}

function workspaceDirs(patterns: readonly string[]): string[] {
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) {
      return existsSync(join(pattern, 'package.json')) ? [pattern] : []
    }

    const parent = pattern.slice(0, -2)

    if (!existsSync(parent)) {
      return []
    }

    return readdirSync(parent, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(parent, entry.name, 'package.json')),
      )
      .map((entry) => join(parent, entry.name))
  })
}

function problemsOf(dir: string): string[] {
  const name = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string })
    .name
  const readme = join(dir, 'README.md')

  if (!existsSync(readme)) {
    return [`${dir}: README.md is missing`]
  }

  const text = readFileSync(readme, 'utf8')
  const title = text.split('\n')[0] ?? ''
  const problems: string[] = []

  if (!(title.startsWith('# ') && title.includes(`(\`${name}\`)`))) {
    problems.push(`${readme}: the first line must be "# <Title> (\`${name}\`)"`)
  }

  for (const section of SECTIONS) {
    if (!text.split('\n').includes(section)) {
      problems.push(`${readme}: section "${section}" is missing`)
    }
  }

  return problems
}

function moduleDirs(workspaces: readonly string[]): string[] {
  return workspaces.flatMap((dir) => {
    const features = join(dir, 'src', 'features')

    if (!existsSync(features)) {
      return []
    }

    return readdirSync(features, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SUPPORT_FOLDER.test(entry.name))
      .map((entry) => join(features, entry.name))
  })
}

/** The module id: from the manifest when the folder has one, else the folder name. */
function moduleIdOf(dir: string): { readonly id: string; readonly problem?: string } {
  const manifest = readdirSync(dir).find((name) => name.endsWith('.module.ts'))

  if (manifest === undefined) {
    return { id: basename(dir) }
  }

  const source = readFileSync(join(dir, manifest), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const match = /\bid\s*:\s*(['"])([^'"]+)\1/.exec(source)

  if (match?.[2] === undefined) {
    return {
      id: basename(dir),
      problem: `${join(dir, manifest)}: the module id could not be read (expected id: '<name>')`,
    }
  }

  return { id: match[2] }
}

function moduleProblemsOf(dir: string): string[] {
  const { id, problem } = moduleIdOf(dir)
  const readme = join(dir, 'README.md')

  if (!existsSync(readme)) {
    return [...(problem ? [problem] : []), `${dir}: README.md is missing (module \`${id}\`)`]
  }

  const text = readFileSync(readme, 'utf8')
  const title = text.split('\n')[0] ?? ''
  const problems: string[] = problem ? [problem] : []

  if (problem === undefined && !(title.startsWith('# ') && title.includes(`(module \`${id}\`)`))) {
    problems.push(`${readme}: the first line must be "# <Title> (module \`${id}\`)"`)
  }

  for (const section of MODULE_SECTIONS) {
    if (!text.split('\n').includes(section)) {
      problems.push(`${readme}: section "${section}" is missing`)
    }
  }

  return problems
}

const root = JSON.parse(readFileSync('package.json', 'utf8')) as RootManifest
const workspaces = workspaceDirs(root.workspaces.packages)
const problems = [
  ...workspaces.flatMap(problemsOf),
  ...moduleDirs(workspaces).flatMap(moduleProblemsOf),
]

for (const problem of problems) {
  console.error(problem)
}

if (problems.length > 0) {
  process.exit(1)
}

console.log('every workspace and module has a README with the expected sections')

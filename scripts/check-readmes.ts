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
 * are not modules. The id is read from the object literal passed to `defineModule`, by a
 * scan that steps over comments and strings and ignores nested objects. This check fails
 * when a workspace or a module has no README.md, when the title does not name it, when a
 * manifest's id cannot be read, or when a section is missing. Keeping
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

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

/** The index just past the string literal that starts at `start` (escapes honoured). */
function endOfString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1

  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }

    if (source[i] === quote) {
      return i + 1
    }

    i += 1
  }

  return source.length
}

/** The index past the comment or string literal that starts at `i`, or `i` when code starts there. */
function skipNonCode(source: string, i: number): number {
  const two = source.slice(i, i + 2)

  if (two === '//') {
    const end = source.indexOf('\n', i)

    return end === -1 ? source.length : end
  }

  if (two === '/*') {
    const end = source.indexOf('*/', i + 2)

    return end === -1 ? source.length : end + 2
  }

  const quote = source[i]

  if (quote === "'" || quote === '"' || quote === '`') {
    return endOfString(source, i)
  }

  return i
}

/** The last code character before `i`, skipping whitespace. */
function codeCharBefore(source: string, i: number): string {
  let j = i - 1

  while (j >= 0 && /\s/.test(source[j] ?? '')) {
    j -= 1
  }

  return source[j] ?? ''
}

/** The string value of the property `id: '<value>'` whose key starts at `i`, or undefined. */
function stringValueAt(source: string, i: number): string | undefined {
  const rest = /^id\s*:\s*/.exec(source.slice(i))

  if (rest === null) {
    return undefined
  }

  const valueStart = i + rest[0].length
  const quote = source[valueStart]

  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return undefined
  }

  const valueEnd = endOfString(source, valueStart)
  const value = source.slice(valueStart + 1, valueEnd - 1)

  return quote === '`' && value.includes('${') ? undefined : value
}

/**
 * The `id` of the object literal passed to `defineModule(...)`: a scan over the source that
 * steps over comments and strings, finds the call, and reads only a property of the literal's
 * own top level, so an `id` of a nested object, of another object before the call, or inside
 * a comment or a string is never taken. Undefined when the manifest has no such property or
 * its value is not a plain string.
 */
function readModuleId(source: string): string | undefined {
  let i = 0
  let depth = -1

  while (i < source.length) {
    const next = skipNonCode(source, i)

    if (next !== i) {
      i = next
      continue
    }

    const ch = source[i] ?? ''

    if (depth === -1) {
      if (source.startsWith('defineModule', i) && !IDENTIFIER_CHAR.test(source[i - 1] ?? '')) {
        const open = source.indexOf('{', i)

        if (open === -1) {
          return undefined
        }

        depth = 1
        i = open + 1
        continue
      }

      i += 1
      continue
    }

    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1

      if (depth === 0) {
        return undefined
      }
    } else if (
      depth === 1 &&
      source.startsWith('id', i) &&
      !IDENTIFIER_CHAR.test(source[i - 1] ?? '') &&
      ['{', ','].includes(codeCharBefore(source, i))
    ) {
      const value = stringValueAt(source, i)

      if (value !== undefined) {
        return value
      }
    }

    i += 1
  }

  return undefined
}

/** The module id: from the manifest when the folder has one, else the folder name. */
function moduleIdOf(dir: string): { readonly id: string; readonly problem?: string } {
  const manifest = readdirSync(dir).find((name) => name.endsWith('.module.ts'))

  if (manifest === undefined) {
    return { id: basename(dir) }
  }

  const id = readModuleId(readFileSync(join(dir, manifest), 'utf8'))

  if (id === undefined) {
    return {
      id: basename(dir),
      problem: `${join(dir, manifest)}: the module id could not be read (expected defineModule({ id: '<name>', ... }))`,
    }
  }

  return { id }
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

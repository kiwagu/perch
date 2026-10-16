/**
 * Every workspace package carries a short README that a reader can trust:
 *
 *   # <Title> (`<package name>`)
 *   ## Role in the architecture
 *   ## Key exports
 *   ## Commands
 *
 * This check fails when a workspace has no README.md, when the title does not
 * name the package, or when a section is missing. Keeping the content current is
 * part of any change to a package's role, exports or scripts.
 *
 * Usage: bun run scripts/check-readmes.ts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SECTIONS = ['## Role in the architecture', '## Key exports', '## Commands']

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

const root = JSON.parse(readFileSync('package.json', 'utf8')) as RootManifest
const problems = workspaceDirs(root.workspaces.packages).flatMap(problemsOf)

for (const problem of problems) {
  console.error(problem)
}

if (problems.length > 0) {
  process.exit(1)
}

console.log('every workspace has a README with the expected sections')

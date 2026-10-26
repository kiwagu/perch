/**
 * Every workspace package carries a README with the title `# <Title> (`<package name>`)`
 * and the sections below.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SECTIONS = ['## Role in the architecture', '## Key exports', '## Commands']

/** The workspace folders of the root manifest's patterns (`apps/*`, `database`), under `root`. */
export function workspaceDirs(root: string, patterns: readonly string[]): string[] {
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) {
      const dir = join(root, pattern)

      return existsSync(join(dir, 'package.json')) ? [dir] : []
    }

    const parent = join(root, pattern.slice(0, -2))

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

/** What is wrong with a workspace's README, or nothing. */
export function packageProblems(dir: string): string[] {
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

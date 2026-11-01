/**
 * Every module carries a README of its own, so its details do not pile up in its
 * application's README: the title `# <Title> (module `<id>`)` and the sections below. A
 * module is a feature module, a folder under a workspace's `src/features/`, or a gateway
 * module, a folder under `apps/gateway/src/` other than the composition root, which
 * assembles the modules and is not one. Support folders (`__fixtures__`, `__snapshots__`,
 * dot folders) are not modules.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { moduleIdOf } from './module-id.ts'

const MODULE_SECTIONS = ['## Role in the architecture', '## Surface', '## Commands']
const SUPPORT_FOLDER = /^(__|\.)/
const GATEWAY_MODULES = join('apps', 'gateway', 'src')
const COMPOSITION_ROOT = 'composition'

/** The folders directly under `dir` that are not support folders. */
function moduleFoldersIn(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SUPPORT_FOLDER.test(entry.name))
    .map((entry) => join(dir, entry.name))
}

/** The feature modules of the workspaces. */
export function featureModuleDirs(workspaces: readonly string[]): string[] {
  return workspaces.flatMap((dir) => moduleFoldersIn(join(dir, 'src', 'features')))
}

/** The gateway's modules under `root`, the repository root. */
export function gatewayModuleDirs(root: string): string[] {
  return moduleFoldersIn(join(root, GATEWAY_MODULES)).filter(
    (dir) => basename(dir) !== COMPOSITION_ROOT,
  )
}

/** What is wrong with a module's README, or nothing. */
export function moduleProblems(dir: string): string[] {
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

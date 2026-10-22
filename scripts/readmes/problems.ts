import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { featureModuleDirs, gatewayModuleDirs, moduleProblems } from './modules.ts'
import { packageProblems, workspaceDirs } from './packages.ts'

interface RootManifest {
  readonly workspaces: { readonly packages: readonly string[] }
}

/** Every README problem of the repository at `root`: its workspaces, then its modules. */
export function readmeProblems(root: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as RootManifest
  const workspaces = workspaceDirs(root, manifest.workspaces.packages)
  const modules = [...featureModuleDirs(workspaces), ...gatewayModuleDirs(root)]

  return [...workspaces.flatMap(packageProblems), ...modules.flatMap(moduleProblems)]
}

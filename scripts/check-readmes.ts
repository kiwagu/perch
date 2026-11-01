/**
 * Every workspace package carries a short README that a reader can trust:
 *
 *   # <Title> (`<package name>`)
 *   ## Role in the architecture
 *   ## Key exports
 *   ## Commands
 *
 * and so does every module, whose details belong to it rather than to its application's
 * README: a feature module (a folder under `src/features/` of a workspace) and a gateway
 * module (a folder under `apps/gateway/src/`, the composition root aside):
 *
 *   # <Title> (module `<id>`)
 *   ## Role in the architecture
 *   ## Surface
 *   ## Commands
 *
 * The module id is the `id` of its `*.module.ts` manifest, or the folder name when the
 * folder has no manifest; support folders (`__fixtures__`, `__snapshots__`, dot folders)
 * are not modules. This check fails when a workspace or a module has no README.md, when the
 * title does not name it, when a manifest's id cannot be read, or when a section is missing.
 * Keeping the content current is part of any change to a package's role, exports or
 * scripts, or to a module's routes, shapes, commands or providers.
 *
 * Usage: bun run scripts/check-readmes.ts
 */

import { readmeProblems } from './readmes/index.ts'

const problems = readmeProblems('.')

for (const problem of problems) {
  console.error(problem)
}

if (problems.length > 0) {
  process.exit(1)
}

console.log('every workspace and module has a README with the expected sections')

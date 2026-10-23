/**
 * The contract tooling, run from the repository root.
 *
 *   ui-contract check [--sources [--ahead]] [--consumers [--tests=<dir>]]
 *     checks the contract files under `contract/` (the activities included) and the scenario
 *     files under `tests/e2e/scenarios/` against each other; with `--sources`, then the anchors and codes
 *     of the web app and the UI kit against them (with `--ahead`, an anchor declared but not
 *     rendered yet is allowed: the contract runs ahead of the app on a branch); with `--consumers`, then the anchors, codes,
 *     states and values the e2e tests under `tests/e2e/src` (or `<dir>`) name as literals.
 *   ui-contract schemas
 *     writes the JSON Schemas of the contract files under `contract/` from their Zod sources.
 *   ui-contract schemas --check
 *     fails when a committed schema is missing or differs from its source.
 *   ui-contract manifest [--out <dir>]
 *     builds the UI manifest from the contract files and the scenarios and writes it,
 *     with its schema and the model's beside it, into `<dir>` (default `ui-manifest`,
 *     relative to the working directory; its last segment is `ui-manifest`). Runs from the
 *     root or any folder under it.
 *   ui-contract diff <ref> [--json]
 *     prints what the contract of the working tree adds, removes and renames against the
 *     contract at the git ref `<ref>` (all of it as added when the ref has no `contract/`),
 *     the activities included with the transitions changed in each: the hand-over block of a
 *     change, or the changes as JSON.
 *   ui-contract coverage [--write] [--json] [--unmarked]
 *     prints the coverage block (the fields and actions of the model bound by anchors, the
 *     transitions of each activity its scenarios walk, the controls marked per module,
 *     anchors and scenarios per screen), writes it between the
 *     markers of `contract/COVERAGE.md`, prints the measure as JSON, or lists the unmarked
 *     and the ignored controls as `file:line: <element>`. A coverage-ignore marker it cannot
 *     apply, or that ignores no control, is printed as a problem, and nothing is written.
 *   ui-contract routes [--json]
 *     prints the routes of the screen files: the table (path, screen, guard, roles, history,
 *     params, search, file), one example link per binding (each path parameter from its
 *     `examples`, every search key at its default, written as the router writes a link:
 *     `/sample/thg_01hzx9k2`, `/org?view=read&page=1`), where each route is reached from
 *     (links, the flows' `navigate`, the activities' states) and the tree under `__root`;
 *     or all of it as JSON.
 */

import { check } from './check'
import { coverage } from './coverage'
import { diff } from './diff'
import { manifest } from './manifest'
import { routes } from './routes'
import { schemas } from './schemas'

function dispatch(argv: readonly string[]): number {
  const [command, ...rest] = argv

  switch (command) {
    case 'check':
      return check(rest)
    case 'schemas':
      return schemas(rest)
    case 'manifest':
      return manifest(rest)
    case 'diff':
      return diff(rest)
    case 'coverage':
      return coverage(rest)
    case 'routes':
      return routes(rest)
    default:
      console.error(
        'ui-contract: use "check [--sources [--ahead]] [--consumers [--tests=<dir>]]", "schemas [--check]", "manifest [--out <dir>]", "diff <ref> [--json]", "coverage [--write] [--json] [--unmarked]" or "routes [--json]"',
      )

      return 1
  }
}

/**
 * Runs the command `argv` names and returns its exit code. A command that cannot go on
 * throws; its message is printed and the exit code is 1.
 */
export function run(argv: readonly string[]): number {
  try {
    return dispatch(argv)
  } catch (error) {
    console.error(`ui-contract: ${error instanceof Error ? error.message : String(error)}`)

    return 1
  }
}

/**
 * The platform actions a branch's contract declares before the gateway serves them, for the spec
 * that holds the gateway's routes to the platform's actions. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1` and names the branch's merge base with `main` (`CONTRACT_AHEAD_BASE`): a
 * business commit may declare an action before its route, so an action the contract declares now
 * and did not declare at the base may wait for its route, as the web app's routes wait for a
 * binding declared ahead of them. An action the base declared never waits, and a route that names
 * an action the contract does not declare still fails. On `main` and in `bun run check` (no ahead
 * mode) none waits: every action is a route or the client's own.
 */

import { contractAt } from '@workspace/ui-contract'

export interface ActionsAheadInput {
  /** The actions the contract declares now. */
  readonly declared: readonly string[]
  /** The repository whose base the hook names. */
  readonly root: string
  /** The variables of the spec's process, `process.env`. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/**
 * The actions of `declared` that the contract at the branch's base does not declare, in the ahead
 * mode with a base named; none otherwise. A base whose commit has no contract declared none of
 * them; a base that names no commit, or whose contract does not load, throws.
 */
export function actionsAhead({ declared, root, env }: ActionsAheadInput): ReadonlySet<string> {
  const base = env['CONTRACT_AHEAD_BASE']

  if (env['CONTRACT_AHEAD'] !== '1' || base === undefined || base === '') {
    return new Set()
  }

  const atBase = contractAt(base, root)
  const before = new Set('missing' in atBase ? [] : Object.keys(atBase.screens.platform.actions))

  return new Set(declared.filter((action) => !before.has(action)))
}

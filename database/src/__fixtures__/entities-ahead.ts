/**
 * The entities a branch's model declares before the schema stores them, for the spec that holds
 * the schema to the model. On a branch the pre-commit hook sets `CONTRACT_AHEAD=1` and names the
 * branch's merge base with `main` (`CONTRACT_AHEAD_BASE`): a business commit may declare an entity
 * before its table, so an entity the model declares now and did not declare at the base may wait
 * for its table, as the gateway's routes wait for an action declared ahead of them. An entity the
 * base declared never waits. On `main` and in `bun run check` (no ahead mode) none waits: every
 * entity is stored by its table.
 */

import { contractAt } from '@workspace/ui-contract'

export interface EntitiesAheadInput {
  /** The entities the model declares now, by name. */
  readonly declared: readonly string[]
  /** The repository whose base the hook names. */
  readonly root: string
  /** The variables of the spec's process, `process.env`. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/**
 * The entities of `declared` that the model at the branch's base does not declare, in the ahead
 * mode with a base named; none otherwise. A base whose commit has no contract declared none of
 * them; a base that names no commit, or whose contract does not load, throws.
 */
export function entitiesAhead({ declared, root, env }: EntitiesAheadInput): ReadonlySet<string> {
  const base = env['CONTRACT_AHEAD_BASE']

  if (env['CONTRACT_AHEAD'] !== '1' || base === undefined || base === '') {
    return new Set()
  }

  const atBase = contractAt(base, root)
  const before = new Set('missing' in atBase ? [] : Object.keys(atBase.model.entities))

  return new Set(declared.filter((entity) => !before.has(entity)))
}

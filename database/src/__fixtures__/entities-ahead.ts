/**
 * The entities a branch's model declares before the schema stores them, for the spec that holds
 * the schema to the model. On a branch the pre-commit hook sets `CONTRACT_AHEAD=1` and names the
 * branch's merge base with `main` (`CONTRACT_AHEAD_BASE`): a business commit may declare an entity
 * before its table, so an entity the model declares now and did not declare at the base waits
 * while the schema defines no table of its name, as the gateway's routes wait for an action
 * declared ahead of them. Once the implementation adds its table, the entity is held like any
 * other, and an entity the base declared never waits. On `main` and in `bun run check` (no ahead
 * mode) none waits: every entity is stored by its table.
 */

import { contractAt } from '@workspace/ui-contract'

/** An entity of the model, by its name and the table the model says stores it. */
export interface DeclaredEntity {
  readonly name: string
  readonly table: string
}

export interface EntitiesAheadInput {
  /** The entities the model declares now. */
  readonly declared: readonly DeclaredEntity[]
  /** The tables the schema defines now, by name. */
  readonly stored: ReadonlySet<string>
  /** The repository whose base the hook names. */
  readonly root: string
  /** The variables of the spec's process, `process.env`. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/**
 * The names of the entities of `declared` that wait for their tables: in the ahead mode with a
 * base named, those the model at the branch's base does not declare and whose table the schema
 * does not define yet; none otherwise. A base whose commit has no contract declared none of them;
 * a base that names no commit, or whose contract does not load, throws.
 */
export function entitiesAhead({
  declared,
  stored,
  root,
  env,
}: EntitiesAheadInput): ReadonlySet<string> {
  const base = env['CONTRACT_AHEAD_BASE']

  if (env['CONTRACT_AHEAD'] !== '1' || base === undefined || base === '') {
    return new Set()
  }

  const atBase = contractAt(base, root)
  const before = new Set('missing' in atBase ? [] : Object.keys(atBase.model.entities))

  return new Set(
    declared
      .filter((entity) => !before.has(entity.name) && !stored.has(entity.table))
      .map((entity) => entity.name),
  )
}

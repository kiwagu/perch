/**
 * The budget of the field hints: every `description` keyword of a schema the engine writes into
 * `contract/schemas/` keeps `DESCRIPTION_BUDGET` characters, the budget of a written description. A
 * hint says what its key is for and what does not go in it, and names the rule of the reference
 * that holds the rest. One past the budget is a problem of its schema file, naming the key.
 *
 * The walk reads every schema of the document: the keys of `properties` and `$defs` are names, the
 * values a schema holds as data (`const`, `enum`, `default`, `examples`) are not read, and the hints
 * of record keys (`propertyNames`) and of `allOf` branches count too, which the reference's walk of
 * the keys (`reference/keys.ts`) leaves out by design.
 */

import { DESCRIPTION_BUDGET, descriptionLength } from '../schemas'

import type { Problem } from './problems'

/** A schema the engine writes: its file, and the document. */
interface SchemaOutput {
  readonly file: string
  readonly schema: () => object
}

/** Keywords whose keys are names, each over a schema. */
const NAMED = new Set(['properties', '$defs', 'patternProperties', 'dependentSchemas'])

/** Keywords whose values are data, never schemas. */
const DATA = new Set(['const', 'enum', 'default', 'examples'])

/** How a keyword reads in a key's path, as the reference writes one: `anchors.<name>.binding`. */
const STEP: Readonly<Record<string, string>> = {
  additionalProperties: '<name>',
  propertyNames: '<key>',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Each hint of `node` with the path of its key, depth first. */
function* hintsOf(
  node: unknown,
  path: readonly string[],
): Generator<{ path: string; text: string }> {
  if (Array.isArray(node)) {
    for (const item of node) {
      yield* hintsOf(item, path)
    }

    return
  }

  if (!isObject(node)) {
    return
  }

  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === 'description' && typeof value === 'string') {
      yield { path: path.length === 0 ? '(the root)' : path.join('.'), text: value }
    } else if (NAMED.has(keyword) && isObject(value)) {
      for (const [name, schema] of Object.entries(value)) {
        yield* hintsOf(schema, keyword === '$defs' ? [...path, '$defs', name] : [...path, name])
      }
    } else if (!DATA.has(keyword)) {
      const step = STEP[keyword]

      yield* hintsOf(value, step === undefined ? path : [...path, step])
    }
  }
}

/** One problem for each distinct hint of a written schema past the budget, at its first key. */
export function hintBudgetProblems(outputs: readonly SchemaOutput[]): Problem[] {
  return outputs.flatMap(({ file, schema }) => {
    const keys = new Map<string, string[]>()

    for (const { path, text } of hintsOf(schema(), [])) {
      if (descriptionLength(text) > DESCRIPTION_BUDGET) {
        keys.set(text, [...(keys.get(text) ?? []), path])
      }
    }

    return Array.from(keys, ([text, [first, ...others]]) => ({
      file,
      message: `${first}${others.length === 0 ? '' : ` (and ${others.length} more keys)`}: the field hint is ${descriptionLength(text)} characters, past its budget of ${DESCRIPTION_BUDGET}; keep what the key is for and what does not go in it, and move the rest into a rule of the reference that the hint names (the rule \`<id>\`)`,
    }))
  })
}

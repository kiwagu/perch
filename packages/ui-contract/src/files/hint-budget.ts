/**
 * The budget of the field hints: every `description` keyword of a schema the engine writes into
 * `contract/schemas/` keeps `DESCRIPTION_BUDGET` characters, the budget of a written description. A
 * hint says what its key is for and what does not go in it, and names the rule of the reference
 * that holds the rest. One past the budget is a problem of its schema file, naming the key.
 *
 * The walk follows the keywords of JSON Schema 2020-12 that hold schemas, and nothing else: an
 * extension keyword's metadata and the values a schema holds as data (`const`, `default`) are not
 * read. A `$ref` into `$defs` is followed where it is first used, so a shared definition is named by
 * the key that refers to it, as the reference names it; a definition nothing refers to is read at
 * its own path. Unlike the reference's walk of the keys (`reference/keys.ts`), it also reads the
 * hints of record keys (`propertyNames`) and of `allOf` branches.
 */

import { DESCRIPTION_BUDGET, descriptionLength } from '../schemas'

import type { Problem } from './problems'

/** A schema the engine writes: its file, and the document. */
interface SchemaOutput {
  readonly file: string
  readonly schema: () => object
}

/** Keywords whose value is one schema, with how each reads in a key's path (`anchors.<name>`). */
const ONE = new Map<string, string | undefined>([
  ['additionalProperties', '<name>'],
  ['propertyNames', '<key>'],
  ['unevaluatedProperties', '<name>'],
  ['items', undefined],
  ['contains', undefined],
  ['unevaluatedItems', undefined],
  ['not', undefined],
  ['if', undefined],
  ['then', undefined],
  ['else', undefined],
])

/** Keywords whose value is a list of schemas, read at the same key. */
const LIST = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

/** Keywords whose value maps names to schemas, each name a key. */
const NAMED = new Set(['properties', 'patternProperties', 'dependentSchemas'])

const DEFS = '#/$defs/'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface Hint {
  readonly path: string
  readonly text: string
}

/** The definitions of a document, and those already read through a `$ref`. */
interface Walk {
  readonly defs: Record<string, unknown>
  readonly visited: Set<string>
}

/** Each hint of the schema `node` with the path of its key, depth first. */
function* hintsOf(node: unknown, path: readonly string[], walk: Walk): Generator<Hint> {
  if (!isObject(node)) {
    return
  }

  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === 'description' && typeof value === 'string') {
      yield { path: path.length === 0 ? '(the root)' : path.join('.'), text: value }
    } else if (keyword === '$ref' && typeof value === 'string' && value.startsWith(DEFS)) {
      const name = value.slice(DEFS.length)

      if (!walk.visited.has(name)) {
        walk.visited.add(name)
        yield* hintsOf(walk.defs[name], path, walk)
      }
    } else if (ONE.has(keyword)) {
      const step = ONE.get(keyword)

      yield* hintsOf(value, step === undefined ? path : [...path, step], walk)
    } else if (LIST.has(keyword) && Array.isArray(value)) {
      for (const branch of value) {
        yield* hintsOf(branch, path, walk)
      }
    } else if (NAMED.has(keyword) && isObject(value)) {
      for (const [name, schema] of Object.entries(value)) {
        yield* hintsOf(schema, [...path, name], walk)
      }
    }
  }
}

/** Every hint of a document: its schemas from the root, then each definition nothing refers to. */
function* documentHints(document: object): Generator<Hint> {
  const defs = isObject(document) && isObject(document['$defs']) ? document['$defs'] : {}
  const walk: Walk = { defs, visited: new Set() }

  yield* hintsOf(document, [], walk)

  for (const [name, schema] of Object.entries(defs)) {
    if (!walk.visited.has(name)) {
      walk.visited.add(name)
      yield* hintsOf(schema, ['$defs', name], walk)
    }
  }
}

/** One problem for each distinct hint of a written schema past the budget, at its first key. */
export function hintBudgetProblems(outputs: readonly SchemaOutput[]): Problem[] {
  return outputs.flatMap(({ file, schema }) => {
    const keys = new Map<string, string[]>()

    for (const { path, text } of documentHints(schema())) {
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

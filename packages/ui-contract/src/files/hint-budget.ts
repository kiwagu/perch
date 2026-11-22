/**
 * The budget of the field hints: every `description` keyword of a schema the engine writes into
 * `contract/schemas/` keeps `DESCRIPTION_BUDGET` characters, the budget of a written description. A
 * hint says what its key is for and what does not go in it, and names the rule of the reference
 * that holds the rest. One past the budget is a problem of its schema file, naming the key.
 *
 * The walk follows the keywords of JSON Schema 2020-12 that hold schemas, and nothing else: an
 * extension keyword's metadata and the values a schema holds as data (`const`, `default`) are not
 * read. It reads first along the keywords the reference's walk of the keys follows
 * (`reference/keys.ts`: `properties`, `additionalProperties`, `items`, `anyOf`, `oneOf`, `$ref`), in
 * its order, so a shared definition is named by the key the reference names it under; then the
 * keywords only the budget reads (`allOf`, `propertyNames`, a nested `$defs` and the rest); then
 * each definition nothing refers to, at its own path.
 */

import { DESCRIPTION_BUDGET, descriptionLength } from '../schemas'

import type { Problem } from './problems'

/** A schema the engine writes: its file, and the document. */
interface SchemaOutput {
  readonly file: string
  readonly schema: () => object
}

/** Keywords outside the reference's walk whose value is one schema, with how each reads in a path. */
const ONE = new Map<string, string | undefined>([
  ['propertyNames', '<key>'],
  ['unevaluatedProperties', '<name>'],
  ['contains', undefined],
  ['unevaluatedItems', undefined],
  ['not', undefined],
  ['if', undefined],
  ['then', undefined],
  ['else', undefined],
])

/** Keywords outside the reference's walk whose value is a list of schemas, read at the same key. */
const LIST = new Set(['allOf', 'prefixItems'])

/** Keywords outside the reference's walk whose value maps names to schemas, each name a key. */
const NAMED = new Set(['patternProperties', 'dependentSchemas'])

/** Keywords that hold definitions, each read at its own path where nothing refers to it first. */
const DEFINITIONS = new Set(['$defs', 'definitions'])

const DEFS = '#/$defs/'

/** How many characters of a long hint its problem quotes, to tell two hints at one key apart. */
const OPENING = 24

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

interface Hint {
  readonly path: string
  readonly text: string
}

/** A schema to read later, at its key. */
interface Pending {
  readonly node: unknown
  readonly path: readonly string[]
}

/** The definitions of a document, those already read, and the schemas left for later. */
interface Walk {
  readonly defs: Record<string, unknown>
  readonly visited: Set<string>
  readonly later: Pending[]
}

/** The schemas a keyword outside the reference's walk holds, each at its key. */
function laterOf(keyword: string, value: unknown, path: readonly string[]): Pending[] {
  if (ONE.has(keyword)) {
    const step = ONE.get(keyword)

    return [{ node: value, path: step === undefined ? path : [...path, step] }]
  }

  if (LIST.has(keyword)) {
    return listOf(value).map((node) => ({ node, path }))
  }

  if (NAMED.has(keyword) && isObject(value)) {
    return Object.entries(value).map(([name, node]) => ({ node, path: [...path, name] }))
  }

  if (DEFINITIONS.has(keyword) && isObject(value)) {
    return Object.entries(value).map(([name, node]) => ({ node, path: [...path, keyword, name] }))
  }

  return []
}

/**
 * Each hint of the schema `node` along the reference's keywords, in its order; the schemas other
 * keywords hold go to `walk.later`. `root` marks the document, whose `$defs` are read by reference.
 */
function* hintsOf(
  node: unknown,
  path: readonly string[],
  walk: Walk,
  root = false,
): Generator<Hint> {
  if (!isObject(node)) {
    return
  }

  const { description, properties, additionalProperties, items, anyOf, oneOf, $ref } = node

  if (typeof description === 'string') {
    yield { path: path.length === 0 ? '(the root)' : path.join('.'), text: description }
  }

  if (isObject(properties)) {
    for (const [name, schema] of Object.entries(properties)) {
      yield* hintsOf(schema, [...path, name], walk)
    }
  }

  yield* hintsOf(additionalProperties, [...path, '<name>'], walk)
  yield* hintsOf(items, path, walk)

  for (const branch of [...listOf(anyOf), ...listOf(oneOf)]) {
    yield* hintsOf(branch, path, walk)
  }

  if (typeof $ref === 'string' && $ref.startsWith(DEFS)) {
    const name = $ref.slice(DEFS.length)

    if (!walk.visited.has(name)) {
      walk.visited.add(name)
      yield* hintsOf(walk.defs[name], path, walk)
    }
  }

  for (const [keyword, value] of Object.entries(node)) {
    if (!(root && keyword === '$defs')) {
      walk.later.push(...laterOf(keyword, value, path))
    }
  }
}

/** Every hint of a document: by the reference's keywords, then the others, then lone definitions. */
function* documentHints(document: object): Generator<Hint> {
  const defs = isObject(document) && isObject(document['$defs']) ? document['$defs'] : {}
  const walk: Walk = { defs, visited: new Set(), later: [] }

  yield* hintsOf(document, [], walk, true)

  for (let pending = walk.later.shift(); pending !== undefined; pending = walk.later.shift()) {
    yield* hintsOf(pending.node, pending.path, walk)
  }

  for (const [name, schema] of Object.entries(defs)) {
    if (!walk.visited.has(name)) {
      walk.visited.add(name)
      yield* hintsOf(schema, ['$defs', name], walk)

      for (let pending = walk.later.shift(); pending !== undefined; pending = walk.later.shift()) {
        yield* hintsOf(pending.node, pending.path, walk)
      }
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
      message: `${first} ("${[...text].slice(0, OPENING).join('')}…")${others.length === 0 ? '' : ` (and ${others.length} more keys)`}: the field hint is ${descriptionLength(text)} characters, past its budget of ${DESCRIPTION_BUDGET}; keep what the key is for and what does not go in it, and move the rest into a rule of the reference that the hint names (the rule \`<id>\`)`,
    }))
  })
}

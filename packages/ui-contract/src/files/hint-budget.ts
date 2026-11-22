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

/** Where a schema stands: its key as the reference writes it, and its JSON pointer in the document. */
interface Place {
  readonly key: readonly string[]
  readonly pointer: readonly string[]
}

interface Hint {
  readonly key: string
  readonly pointer: string
  readonly text: string
}

/** A schema to read later, at its place. */
interface Pending {
  readonly node: unknown
  readonly at: Place
}

/** The definitions of a document, those already read, and the schemas left for later. */
interface Walk {
  readonly defs: Record<string, unknown>
  readonly visited: Set<string>
  readonly later: Pending[]
}

/** The place one step down: `key` added to the key unless absent, `steps` to the pointer. */
const down = (at: Place, key: string | undefined, ...steps: string[]): Place => ({
  key: key === undefined ? at.key : [...at.key, key],
  pointer: [...at.pointer, ...steps],
})

/** A JSON pointer (RFC 6901) into the document, `#/properties/binding/anyOf/0`. */
const pointerOf = (steps: readonly string[]): string =>
  `#${steps.map((step) => `/${step.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')}`

/** The schemas a keyword outside the reference's walk holds, each at its place. */
function laterOf(keyword: string, value: unknown, at: Place): Pending[] {
  if (ONE.has(keyword)) {
    return [{ node: value, at: down(at, ONE.get(keyword), keyword) }]
  }

  if (LIST.has(keyword)) {
    return listOf(value).map((node, index) => ({
      node,
      at: down(at, undefined, keyword, String(index)),
    }))
  }

  if (NAMED.has(keyword) && isObject(value)) {
    return Object.entries(value).map(([name, node]) => ({
      node,
      at: down(at, name, keyword, name),
    }))
  }

  if (DEFINITIONS.has(keyword) && isObject(value)) {
    return Object.entries(value).map(([name, node]) => ({
      node,
      at: { key: [...at.key, keyword, name], pointer: [...at.pointer, keyword, name] },
    }))
  }

  return []
}

/**
 * Each hint of the schema `node` along the reference's keywords, in its order; the schemas other
 * keywords hold go to `walk.later`. `root` marks the document, whose `$defs` are read by reference.
 */
function* hintsOf(node: unknown, at: Place, walk: Walk, root = false): Generator<Hint> {
  if (!isObject(node)) {
    return
  }

  const { description, properties, additionalProperties, items, anyOf, oneOf, $ref } = node

  if (typeof description === 'string') {
    yield {
      key: at.key.length === 0 ? '(the root)' : at.key.join('.'),
      pointer: pointerOf(at.pointer),
      text: description,
    }
  }

  if (isObject(properties)) {
    for (const [name, schema] of Object.entries(properties)) {
      yield* hintsOf(schema, down(at, name, 'properties', name), walk)
    }
  }

  yield* hintsOf(additionalProperties, down(at, '<name>', 'additionalProperties'), walk)
  yield* hintsOf(items, down(at, undefined, 'items'), walk)

  for (const [keyword, list] of [
    ['anyOf', anyOf],
    ['oneOf', oneOf],
  ] as const) {
    for (const [index, branch] of listOf(list).entries()) {
      yield* hintsOf(branch, down(at, undefined, keyword, String(index)), walk)
    }
  }

  if (typeof $ref === 'string' && $ref.startsWith(DEFS)) {
    const name = $ref.slice(DEFS.length)

    if (!walk.visited.has(name)) {
      walk.visited.add(name)
      yield* hintsOf(walk.defs[name], { key: at.key, pointer: ['$defs', name] }, walk)
    }
  }

  for (const [keyword, value] of Object.entries(node)) {
    if (!(root && keyword === '$defs')) {
      walk.later.push(...laterOf(keyword, value, at))
    }
  }
}

/** Every hint of a document: by the reference's keywords, then the others, then lone definitions. */
function* documentHints(document: object): Generator<Hint> {
  const defs = isObject(document) && isObject(document['$defs']) ? document['$defs'] : {}
  const walk: Walk = { defs, visited: new Set(), later: [] }

  yield* hintsOf(document, { key: [], pointer: [] }, walk, true)

  for (let pending = walk.later.shift(); pending !== undefined; pending = walk.later.shift()) {
    yield* hintsOf(pending.node, pending.at, walk)
  }

  for (const [name, schema] of Object.entries(defs)) {
    if (!walk.visited.has(name)) {
      walk.visited.add(name)
      yield* hintsOf(schema, { key: ['$defs', name], pointer: ['$defs', name] }, walk)

      for (let pending = walk.later.shift(); pending !== undefined; pending = walk.later.shift()) {
        yield* hintsOf(pending.node, pending.at, walk)
      }
    }
  }
}

/** One problem for each distinct hint of a written schema past the budget, at its first key. */
export function hintBudgetProblems(outputs: readonly SchemaOutput[]): Problem[] {
  return outputs.flatMap(({ file, schema }) => {
    const found = new Map<string, Hint[]>()

    for (const hint of documentHints(schema())) {
      if (descriptionLength(hint.text) > DESCRIPTION_BUDGET) {
        found.set(hint.text, [...(found.get(hint.text) ?? []), hint])
      }
    }

    return Array.from(found.values(), ([first, ...others]) => {
      const { key, pointer, text } = first as Hint

      return {
        file,
        message: `${key} ("${[...text].slice(0, OPENING).join('')}…" at ${pointer})${others.length === 0 ? '' : ` (and ${others.length} more keys)`}: the field hint is ${descriptionLength(text)} characters, past its budget of ${DESCRIPTION_BUDGET}; keep what the key is for and what does not go in it, and move the rest into a rule of the reference that the hint names (the rule \`<id>\`)`,
      }
    })
  })
}

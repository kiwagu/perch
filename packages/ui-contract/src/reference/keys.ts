/**
 * The keys of the contract's files, read from the JSON Schemas the engine writes for them: each
 * key a schema describes, by its file and its path from the file's root, with its describe text.
 */

import {
  ACTIVITY_SCHEMA_FILE,
  ENTITY_SCHEMA_FILE,
  MANIFEST_SCHEMA_FILE,
  PLATFORM_SCHEMA_FILE,
  SCHEMA_OUTPUTS,
  SCREEN_SCHEMA_FILE,
} from '../files'

/** A file the reference describes: its name in a slug, its section's title and its schema. */
export interface ReferenceFile {
  readonly name: string
  readonly title: string
  readonly schemaFile: string
}

/** The five roots, in the order the reference writes their sections. */
const REFERENCE_FILES: readonly ReferenceFile[] = [
  { name: 'screen', title: 'Screen file', schemaFile: SCREEN_SCHEMA_FILE },
  { name: 'platform', title: 'Platform file', schemaFile: PLATFORM_SCHEMA_FILE },
  { name: 'activity', title: 'Activity file', schemaFile: ACTIVITY_SCHEMA_FILE },
  { name: 'model', title: 'Model (x-perch)', schemaFile: ENTITY_SCHEMA_FILE },
  { name: 'manifest', title: 'Manifest (derived)', schemaFile: MANIFEST_SCHEMA_FILE },
]

/** A key of a file: the property names from the file's root, a map's value written `<name>`. */
export interface ReferenceKey {
  readonly file: string
  readonly path: readonly string[]
  readonly description: string
}

/** What a map's value stands as in a key's path: `anchors.<name>.secret`. */
const MAP_VALUE = '<name>'

const DEFS = '#/$defs/'

type JsonObject = { readonly [keyword: string]: unknown }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const branchesOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

/**
 * The described keys under `node`, depth first: a property adds its name to the path, a map's
 * value `<name>`; the items of a list, the branches of `anyOf` and `oneOf` and a `$ref` into
 * `$defs` keep the path, each definition followed once (`visited`).
 */
function* walk(
  node: unknown,
  path: readonly string[],
  defs: JsonObject,
  visited: Set<string>,
): Generator<{ path: readonly string[]; description: string }> {
  if (!isObject(node)) {
    return
  }

  const { description, properties, additionalProperties, items, anyOf, oneOf, $ref } = node

  if (path.length > 0 && typeof description === 'string') {
    yield { path, description }
  }

  if (isObject(properties)) {
    for (const [name, property] of Object.entries(properties)) {
      yield* walk(property, [...path, name], defs, visited)
    }
  }

  yield* walk(additionalProperties, [...path, MAP_VALUE], defs, visited)
  yield* walk(items, path, defs, visited)

  for (const branch of [...branchesOf(anyOf), ...branchesOf(oneOf)]) {
    yield* walk(branch, path, defs, visited)
  }

  if (typeof $ref === 'string' && $ref.startsWith(DEFS)) {
    const name = $ref.slice(DEFS.length)

    if (!visited.has(name)) {
      visited.add(name)
      yield* walk(defs[name], path, defs, visited)
    }
  }
}

/** The described keys of `schema`, the JSON Schema of `file`; the first occurrence of a path wins. */
export function schemaKeys(file: string, schema: unknown): ReferenceKey[] {
  const defs = isObject(schema) && isObject(schema['$defs']) ? schema['$defs'] : {}
  const seen = new Set<string>()
  const keys: ReferenceKey[] = []

  for (const { path, description } of walk(schema, [], defs, new Set())) {
    const id = JSON.stringify(path)

    if (!seen.has(id)) {
      seen.add(id)
      keys.push({ file, path, description })
    }
  }

  return keys
}

/** A file's section of the reference: what its schema says the file is, and its keys. */
export interface ReferenceSection {
  readonly file: ReferenceFile
  readonly description?: string
  readonly keys: readonly ReferenceKey[]
}

/** The section of each of the five roots, read from the schema the engine writes for it. */
export function referenceSections(): ReferenceSection[] {
  return REFERENCE_FILES.map((file) => {
    const output = SCHEMA_OUTPUTS.find((candidate) => candidate.file === file.schemaFile)

    if (output === undefined) {
      throw new Error(`the engine writes no schema ${file.schemaFile}`)
    }

    const schema = output.schema()
    const description = isObject(schema) ? schema['description'] : undefined
    const keys = schemaKeys(file.name, schema)

    return typeof description === 'string' ? { file, description, keys } : { file, keys }
  })
}

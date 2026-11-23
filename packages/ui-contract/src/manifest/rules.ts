/**
 * The rules of the engine a manifest names, carried in it. The manifest and its schema name rules
 * (the rule `address-key`) and an implementer handed the manifest folder alone never sees the
 * reference that holds their texts, so each rule the folder names is written into the manifest,
 * from the registry the reference is written from (`REFERENCE_RULES`, `ruleTextOf`): one source,
 * the same text, and none for a rule the folder does not name.
 */

import { MANIFEST_SCHEMA_FILE, SCHEMA_OUTPUTS } from '../files'
import { REFERENCE_RULES, ruleIdsNamedIn, ruleTextOf } from '../reference'

import type { Manifest } from './manifest.types'

/** Each string of a JSON document, a key's name excepted. */
function* stringsOf(node: unknown): Generator<string> {
  if (typeof node === 'string') {
    yield node
  } else if (Array.isArray(node)) {
    for (const item of node) {
      yield* stringsOf(item)
    }
  } else if (typeof node === 'object' && node !== null) {
    for (const value of Object.values(node)) {
      yield* stringsOf(value)
    }
  }
}

const namedIn = (document: unknown): string[] =>
  Array.from(stringsOf(document)).flatMap(ruleIdsNamedIn)

/** The ids the schema of the manifest names, which the folder carries beside the manifest. */
let named: readonly string[] | undefined

function namedBySchema(): readonly string[] {
  if (named === undefined) {
    const output = SCHEMA_OUTPUTS.find(({ file }) => file === MANIFEST_SCHEMA_FILE)

    if (output === undefined) {
      throw new Error(`the engine writes no schema ${MANIFEST_SCHEMA_FILE}`)
    }

    named = namedIn(output.schema())
  }

  return named
}

/**
 * The rules `document`, the manifest before this key, and the schema of the manifest name: each by
 * its id with its title and its text as the reference writes them, in the order of the reference.
 * A name that is no rule of the registry carries nothing, and the names inside the texts carried
 * are not followed: one step, as the manifest is read.
 */
export function rulesOf(document: unknown): Manifest['rules'] {
  const ids = new Set([...namedIn(document), ...namedBySchema()])

  return Object.fromEntries(
    REFERENCE_RULES.filter(({ id }) => ids.has(id)).map((rule) => [
      rule.id,
      { title: rule.title, text: ruleTextOf(rule) },
    ]),
  )
}

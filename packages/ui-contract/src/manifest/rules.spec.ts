import { describe, expect, it } from 'vitest'

import { MANIFEST_SCHEMA_FILE, SCHEMA_OUTPUTS } from '../files'
import {
  REFERENCE_RULES,
  type ReferenceRule,
  referenceSlug,
  renderReference,
  ruleIdsNamedIn,
  ruleTextOf,
} from '../reference'
import { manifestSchema } from '../schemas'

import { buildManifest } from './build'
import { fixtureContract } from './manifest.fixture'

const PRODUCT = { name: 'perch', version: '0.0.0', commit: null }
const NOW = new Date('2026-10-21T12:00:00.000Z')

const base = fixtureContract()

/** The fixture manifest, its first screen's description ending in `sentence`. */
function builtWith(sentence: string): ReturnType<typeof buildManifest> {
  const [first, ...others] = base.screens.screens

  if (first === undefined) {
    throw new Error('the fixture has a screen')
  }

  return buildManifest({
    ...base,
    screens: {
      ...base.screens,
      screens: [{ ...first, description: `${first.description} ${sentence}` }, ...others],
    },
    product: PRODUCT,
    now: NOW,
  })
}

const manifest = builtWith('')

/** A JSON document as one text, its newlines real: JSON writes `\n`, which would hide a name. */
const textOf = (document: unknown): string => JSON.stringify(document).replaceAll('\\n', '\n')

/** What the engine's schema of the manifest names: its descriptions, as the folder carries them. */
const schemaText = textOf(
  SCHEMA_OUTPUTS.find(({ file }) => file === MANIFEST_SCHEMA_FILE)?.schema(),
)

/** A rule of the registry that the fixture manifest and its schema do not name. */
const unnamed: ReferenceRule = (() => {
  const found = REFERENCE_RULES.find(({ id }) => !(id in manifest.rules))

  if (found === undefined) {
    throw new Error('the registry has a rule the manifest does not name')
  }

  return found
})()

describe('the rules a manifest names', () => {
  it('carries the text of each rule its schema names, as the registry and the reference have it', () => {
    const named = new Set(ruleIdsNamedIn(schemaText))
    const reference = renderReference()

    expect(named.size).toBeGreaterThan(0)

    for (const rule of REFERENCE_RULES.filter(({ id }) => named.has(id))) {
      expect(manifest.rules[rule.id]).toEqual({ title: rule.title, text: ruleTextOf(rule) })
      expect(reference).toContain(
        `### ${rule.title}\n\n<a id="${referenceSlug('rule', rule.id)}"></a>\n${ruleTextOf(rule)}\n`,
      )
    }
  })
  it('carries exactly the rules the manifest and its schema name, in the reference order', () => {
    // The names inside the carried texts are not followed: the document is read before the key.
    const { rules: _rules, ...document } = manifest
    const named = new Set([...ruleIdsNamedIn(textOf(document)), ...ruleIdsNamedIn(schemaText)])

    expect(Object.keys(manifest.rules)).toEqual(
      REFERENCE_RULES.filter(({ id }) => named.has(id)).map(({ id }) => id),
    )
  })
  it('carries nothing for a rule it does not name', () => {
    expect(manifest.rules).not.toHaveProperty(unnamed.id)
    expect(Object.keys(manifest.rules).length).toBeLessThan(REFERENCE_RULES.length)
  })
  it('carries a rule once a name is added, and drops it once the name is removed', () => {
    const added = builtWith(`See the rule \`${unnamed.id}\`.`)

    expect(added.rules[unnamed.id]).toEqual({ title: unnamed.title, text: ruleTextOf(unnamed) })
    expect(Object.keys(added.rules)).toEqual(
      REFERENCE_RULES.filter(({ id }) => id in manifest.rules || id === unnamed.id).map(
        ({ id }) => id,
      ),
    )
    expect(builtWith('See nothing.').rules).toEqual(manifest.rules)
    expect(builtWith('').rules).not.toHaveProperty(unnamed.id)
  })
  it('carries each rule of a list a name writes', () => {
    const [first, second] = REFERENCE_RULES.filter(
      ({ id }) => !(id in manifest.rules) && id !== unnamed.id,
    )

    expect(first).toBeDefined()
    expect(second).toBeDefined()

    const listed = builtWith(`The rule \`${first?.id}\` or \`${second?.id}\`.`)

    expect(listed.rules).toHaveProperty(first?.id ?? '')
    expect(listed.rules).toHaveProperty(second?.id ?? '')
    expect(listed.rules).not.toHaveProperty(unnamed.id)
  })
  it('carries nothing for a name that is no rule of the registry, and does not stop the build', () => {
    const built = builtWith('See the rule `no-such-rule`.')

    expect(built.rules).toEqual(manifest.rules)
  })
  it('puts the rules last in the manifest, after everything it names them in', () => {
    expect(Object.keys(manifest).at(-1)).toBe('rules')
  })
  it('stays valid against the schema of the manifest', () => {
    expect(manifestSchema.safeParse(manifest).error?.issues).toBeUndefined()
    expect(manifestSchema.safeParse(builtWith(`See the rule \`${unnamed.id}\`.`)).success).toBe(
      true,
    )
  })
  it('names every rule its schema names in the registry', () => {
    const ids = new Set(REFERENCE_RULES.map(({ id }) => id))

    expect(ruleIdsNamedIn(schemaText).filter((id) => !ids.has(id))).toEqual([])
  })
  it('describes the key without naming a rule itself, so the set never depends on it', () => {
    const description = manifestSchema.shape.rules.description ?? ''

    expect(description.length).toBeGreaterThan(0)
    expect(ruleIdsNamedIn(description)).toEqual([])
  })
})

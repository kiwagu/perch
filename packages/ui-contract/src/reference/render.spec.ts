import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { SCHEMA_OUTPUTS, SCREEN_SCHEMA_FILE } from '../files'
import { authoredAnchorDefSchema } from '../schemas'

import { schemaKeys } from './keys'
import { renderReference } from './render'
import { REFERENCE_RULES } from './rules'
import { referenceSlug } from './slug'

interface Entry {
  readonly heading: string
  readonly slug: string
  readonly text: string
}

const reference = renderReference()

/** The line that lists the keys a rule concerns, under its text. */
const KEYS_LINE = 'Keys it concerns: '

/** A heading of the reference: its level, its title and the lines under it. */
interface Block {
  readonly level: number
  readonly title: string
  readonly lines: string[]
}

/**
 * The headings of the reference with the lines under each, those inside a fenced code block read
 * as the text they are: a `## ` at the start of a line of an example is no heading.
 */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = []
  let fenced = false

  for (const line of text.split('\n')) {
    fenced = line.startsWith('```') ? !fenced : fenced

    const heading = fenced ? null : /^(##+) (.+)$/.exec(line)

    if (heading !== null) {
      blocks.push({ level: heading[1]?.length ?? 0, title: heading[2] ?? '', lines: [] })
    } else {
      blocks.at(-1)?.lines.push(line)
    }
  }

  return blocks
}

const blocks = blocksOf(reference)

/**
 * Each `### ` heading of the reference with the anchor under it and the text that follows, up to
 * the line that lists the keys a rule concerns.
 */
const entries: readonly Entry[] = blocks
  .filter(({ level }) => level === 3)
  .map(({ title, lines }) => {
    const anchor = /^<a id="([^"]+)"><\/a>$/.exec(lines[1] ?? '')
    const end = lines.findIndex((line) => line.startsWith(KEYS_LINE))
    const text = lines.slice(2, end === -1 ? undefined : end).join('\n')

    return { heading: title, slug: anchor?.[1] ?? '', text: text.trimEnd() }
  })

const entryAt = (slug: string): Entry | undefined => entries.find((entry) => entry.slug === slug)

/** The facets of the screen file, each a key name: the reference says every one of them in full. */
const FACET_KEYS = [
  'binding',
  'roles',
  'own',
  'holdsInput',
  'marksState',
  'secret',
  'codes',
  'ranked',
  'fields',
  'dataId',
  'dataValue',
  'states',
  'derived',
  'source',
  'composite',
  'confirm',
  'paged',
  'renders',
  'pattern',
] as const

type Facet = (typeof FACET_KEYS)[number]

/**
 * The key where each facet is declared, by its slug: the facets of an anchor are keys of
 * `anchors.<name>`; a name such as `states`, `roles` or `pattern` also names keys elsewhere in the
 * file, whose longer texts must not stand for it.
 */
const FACET_HOMES: Readonly<Record<Facet, string>> = {
  binding: 'screen-anchors-name-binding',
  roles: 'screen-anchors-name-roles',
  own: 'screen-anchors-name-own',
  holdsInput: 'screen-anchors-name-holdsinput',
  marksState: 'screen-anchors-name-marksstate',
  secret: 'screen-anchors-name-secret',
  codes: 'screen-anchors-name-codes',
  ranked: 'screen-anchors-name-ranked',
  fields: 'screen-anchors-name-fields',
  dataId: 'screen-anchors-name-dataid',
  dataValue: 'screen-anchors-name-datavalue',
  states: 'screen-anchors-name-states',
  derived: 'screen-anchors-name-derived',
  source: 'screen-anchors-name-source',
  composite: 'screen-anchors-name-composite',
  confirm: 'screen-anchors-name-confirm',
  paged: 'screen-anchors-name-source-paged',
  renders: 'screen-flow-states-name-meta-renders',
  pattern: 'screen-flow-states-name-states-name-pattern',
}

/** The shortest text that says a facet: what it is and how the engine treats it, not a label. */
const FACET_TEXT_LENGTH = 80

/** The describe text of a key's schema, through the optional that wraps it. */
const describeText = (schema: z.core.$ZodType): string | undefined =>
  z.globalRegistry.get(schema)?.description ??
  (schema instanceof z.ZodOptional ? describeText(schema.unwrap()) : undefined)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The description of `guard` in the transition the screen schema defines under `$defs`. */
function transitionGuardIn({ $defs }: Record<string, unknown>): string | undefined {
  const { authoredTransition } = isObject($defs) ? $defs : {}
  const { anyOf } = isObject(authoredTransition) ? authoredTransition : {}

  for (const branch of Array.isArray(anyOf) ? anyOf : []) {
    const { properties } = isObject(branch) ? branch : {}
    const { guard } = isObject(properties) ? properties : {}
    const { description } = isObject(guard) ? guard : {}

    if (typeof description === 'string') {
      return description
    }
  }

  return undefined
}

describe('renderReference', () => {
  it('opens with its title and says it is generated, never edited', () => {
    const [title, generated] = reference.split('\n')

    expect(title).toBe('# Contract reference')
    expect(generated).toMatch(/^Generated by `bun run contract:schemas`/)
    expect(generated).toContain('never edit it')
  })
  it('gives each file a section, then the rules', () => {
    expect(blocks.filter(({ level }) => level === 2).map(({ title }) => title)).toEqual([
      'Screen file',
      'Platform file',
      'Activity file',
      'Model (x-perch)',
      'Manifest (derived)',
      'Rules',
    ])
  })
  it.each(Object.entries(authoredAnchorDefSchema.shape))(
    "writes the anchor's key %s under its slug, with its describe text",
    (key, schema) => {
      const text = describeText(schema)

      expect(text).toBeTruthy()
      expect(entryAt(referenceSlug('screen', 'anchors', '<name>', key))).toEqual({
        heading: `\`anchors.<name>.${key}\``,
        slug: referenceSlug('screen', 'anchors', '<name>', key),
        text,
      })
    },
  )
  it('writes each rule under `rule-<id>`, with its title and its text', () => {
    expect(REFERENCE_RULES.length).toBeGreaterThan(0)

    for (const rule of REFERENCE_RULES) {
      expect(rule.id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
      expect(entryAt(`rule-${rule.id}`)).toEqual({
        heading: rule.title,
        slug: `rule-${rule.id}`,
        text: rule.text,
      })
    }
  })
  it('names, in each rule, only keys the reference writes, by their file and path', () => {
    const keys = new Set(
      entries.map(({ slug }) => slug).filter((slug) => !slug.startsWith('rule-')),
    )
    const named = REFERENCE_RULES.flatMap((rule) => rule.keys)

    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((key) => !keys.has(referenceSlug(key)))).toEqual([])
    expect(reference).toContain(
      '[`manifest.contract.instructions.gaps`](#manifest-contract-instructions-gaps)',
    )
  })
  it('anchors every heading once, each slug unique', () => {
    const anchors = [...reference.matchAll(/<a id="([^"]+)"><\/a>/g)].map(([, slug]) => slug)

    expect(anchors.length).toBe(entries.length)
    expect(new Set(anchors).size).toBe(anchors.length)
  })
  it('writes a key the schema reaches only through a `$ref` into `$defs`', () => {
    const schema = SCHEMA_OUTPUTS.find(({ file }) => file === SCREEN_SCHEMA_FILE)?.schema() ?? {}
    const written = isObject(schema) ? schema : {}
    const guard = transitionGuardIn(written)
    const slug = 'screen-flow-states-name-on-name-guard'
    const withoutDefs = schemaKeys('screen', { ...written, $defs: {} })

    expect(guard).toBeTruthy()
    expect(withoutDefs.filter((key) => referenceSlug(key.file, ...key.path) === slug)).toEqual([])
    expect(entryAt(slug)?.text).toBe(guard)
  })
  it.each(FACET_KEYS)('writes the facet %s under its key, with its rule in full', (facet) => {
    const home = entryAt(FACET_HOMES[facet])

    expect(home?.heading.endsWith(`${facet}\``)).toBe(true)
    expect(home?.text.length ?? 0).toBeGreaterThanOrEqual(FACET_TEXT_LENGTH)
  })
  it('gives each rule an id of its own', () => {
    const ids = REFERENCE_RULES.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
  })
  it('refers only to rules the reference writes, and links only to anchors it holds', () => {
    const anchors = new Set(entries.map(({ slug }) => slug))
    const ruleIds = new Set(REFERENCE_RULES.map(({ id }) => id))
    const mentioned = [...reference.matchAll(/\brules? `([a-z][a-z0-9-]*)`/g)].map(
      ([, id = '']) => id,
    )
    const linked = [...reference.matchAll(/\]\(#([^)]+)\)/g)].map(([, slug = '']) => slug)

    expect(mentioned.length).toBeGreaterThan(0)
    expect(mentioned.filter((id) => !ruleIds.has(id))).toEqual([])
    expect(linked.filter((slug) => !anchors.has(slug))).toEqual([])
  })
})

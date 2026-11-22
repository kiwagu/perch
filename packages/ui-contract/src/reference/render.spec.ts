import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { SCHEMA_OUTPUTS, SCREEN_SCHEMA_FILE } from '../files'
import { authoredAnchorDefSchema, DESCRIPTION_BUDGET, descriptionLength } from '../schemas'

import { schemaKeys } from './keys'
import { ruleIdsNamedIn } from './mentions'
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

/**
 * What an entry says: its text together with the text of each rule that text names. A key's text
 * says what the key is for and names the rule that holds the rest, so a reader takes both.
 */
function saidBy(entry: Entry | undefined): string {
  const named = ruleIdsNamedIn(entry?.text ?? '').map((id) => entryAt(`rule-${id}`)?.text ?? '')

  return [entry?.text ?? '', ...named].join('\n\n')
}

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

/**
 * The shortest text that says a facet: what it is and how the engine treats it, not a label. A
 * key's own text and the rules it names together reach it.
 */
const FACET_TEXT_LENGTH = 80

/** The facets whose key text is a hint within the budget, its rule held by the rules it names. */
const SHORT_FACETS = FACET_KEYS.filter(
  (facet) => descriptionLength(entryAt(FACET_HOMES[facet])?.text ?? '') <= DESCRIPTION_BUDGET,
)

/**
 * Each rule a facet's hint must name once the hint is short, with a fact of that rule the hint
 * leaves out: a hint that stops naming one of them, or a rule that loses the fact, fails here.
 */
const FACET_RULES: ReadonlyArray<readonly [slug: string, rule: string, fact: string]> = [
  [
    'screen-anchors-name-binding',
    'anchor-binding',
    'An `item` or a `row` named as a parameter gives the `data-id`',
  ],
  [
    'screen-anchors-name-binding',
    'flow-effects',
    'The effects, in `actions`, `entry` and `exit`, are four',
  ],
  [
    'screen-anchors-name-roles',
    'anchor-roles',
    'Every restriction above an anchor admits a device by the roles it holds together',
  ],
  ['screen-anchors-name-roles', 'roles', "A role is a row of the vocabulary's Roles table."],
  [
    'screen-anchors-name-roles',
    'link-roles',
    'A link bound to one route (`binding: { route: /me }`)',
  ],
  [
    'screen-anchors-name-own',
    'own-entries',
    'data (the owner of each entry) decides whether it shows',
  ],
  [
    'screen-anchors-name-holdsinput',
    'field-holds-input',
    'It holds none when its own change applies it at once',
  ],
  ['screen-anchors-name-holdsinput', 'field-holds-input', 'the app is to ask before such a leave'],
  ['screen-anchors-name-marksstate', 'state-colour', "the field's `fieldStates` still hold"],
  [
    'screen-anchors-name-marksstate',
    'check-sources',
    '`bun run contract:check:sources` holds the JSX',
  ],
  ['screen-anchors-name-secret', 'secret-field', 'a secret is never filled from a URL'],
  [
    'screen-anchors-name-dataid',
    'attributes',
    "an invoke's `input` or as a navigate's `{ item }` search",
  ],
  [
    'screen-anchors-name-datavalue',
    'attributes',
    'A value asserted on an anchor must be one that anchor',
  ],
  [
    'screen-anchors-name-datavalue',
    'kind-parts',
    "From version 4 an anchor's kind says what a file would only repeat",
  ],
  ['screen-anchors-name-states', 'attributes', 'The state of a field is not written here'],
  [
    'screen-anchors-name-states',
    'field-states-carried',
    'a reload or leaving the screen clears it',
  ],
  [
    'screen-anchors-name-derived',
    'derived-parts',
    'From version 4 so are the parts a kind brings by itself',
  ],
  [
    'screen-anchors-name-derived',
    'kind-parts',
    "From version 4 an anchor's kind says what a file would only repeat",
  ],
  [
    'screen-anchors-name-derived',
    'visibility-button',
    'One derived part is presentation only: `visibility-button`',
  ],
  [
    'screen-anchors-name-source',
    'list-reads',
    '`{ platform: <action> }`: the entries are the answer of that platform action',
  ],
  [
    'screen-anchors-name-source',
    'paged-list',
    "`paged: true` makes the list a page of the action's entries.",
  ],
  ['screen-anchors-name-composite', 'composite-of-the-platform', 'Only a secret `input` opts in.'],
  [
    'screen-anchors-name-source-paged',
    'paged-list',
    '`paged: { sizes, default }` in `platform.yaml`',
  ],
]

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
    const ruleIds = new Set(REFERENCE_RULES.map(({ id }) => id))

    expect(home?.heading.endsWith(`${facet}\``)).toBe(true)
    expect(ruleIdsNamedIn(home?.text ?? '').filter((id) => !ruleIds.has(id))).toEqual([])
    expect(saidBy(home).length).toBeGreaterThanOrEqual(FACET_TEXT_LENGTH)
  })
  it.each(FACET_RULES)(
    'the hint of %s names the rule %s, which says what the hint leaves out',
    (slug, rule, fact) => {
      expect(ruleIdsNamedIn(entryAt(slug)?.text ?? '')).toContain(rule)
      expect(entryAt(`rule-${rule}`)?.text).toContain(fact)
    },
  )
  it.each(SHORT_FACETS)('lists in FACET_RULES every rule the short hint of %s names', (facet) => {
    const slug = FACET_HOMES[facet]
    const named = ruleIdsNamedIn(entryAt(slug)?.text ?? '')
    const listed = new Set(FACET_RULES.filter(([of]) => of === slug).map(([, rule]) => rule))

    expect(listed.size).toBeGreaterThan(0)
    expect([...listed].sort()).toEqual([...new Set(named)].sort())
  })
  it('says where an error shows each code, and the fields key names that rule', () => {
    expect(entryAt('rule-error-placement')?.text).toContain('shows beside the controls of its part')
    expect(entryAt(referenceSlug('screen', 'anchors', '<name>', 'fields'))?.text).toContain(
      'error-placement',
    )
  })
  it.each(['enabling', 'clear-keeps', 'email-format', 'list-order'])(
    'writes the rule %s under a heading of its own',
    (id) => {
      const entry = entryAt(`rule-${id}`)

      expect(REFERENCE_RULES.map((rule) => rule.id)).toContain(id)
      expect(entry?.heading).toBeTruthy()
      expect(entry?.text.length ?? 0).toBeGreaterThanOrEqual(FACET_TEXT_LENGTH)
    },
  )
  it.each([
    ['screen-anchors-name-codes', 'for one with no code'],
    ['screen-anchors-name-roles', 'whoever is signed in'],
    ['manifest-screens-anchors-name-asks', 'Enter in a field of the asking control'],
    ['manifest-ids-name-asks', 'Enter in a field of the asking control'],
    ['platform-values-name-format', 'through a form without `noValidate`'],
    ['manifest-ids-name-value-format', 'through a form without `noValidate`'],
    ['rule-email-format', 'is submitted by no form'],
    ['rule-clear-keeps', 'while its draft lives'],
    ['rule-clear-keeps', "an entry's edit form closing because another entry is edited or deleted"],
    ['screen-anchors-name-binding', 'a secret is never filled from a URL'],
    ['screen-anchors-name-own', 'data (the owner of each entry) decides whether it shows'],
    ['screen-anchors-name-source-paged', 'a paged list has at most 3 segments'],
  ])('answers a question builders asked, in the text of %s or a rule it names', (slug, answer) => {
    expect(saidBy(entryAt(slug))).toContain(answer)
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

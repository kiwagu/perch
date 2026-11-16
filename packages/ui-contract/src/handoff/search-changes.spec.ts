import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { PLATFORM_FILE } from '../files'
import { LANDING_FILE, writeMailLinkRepository } from '../files/derive/mail-links.fixture'
import { contractAt, fixtureContract } from '../manifest/manifest.fixture'

import { diffContracts } from './diff'
import { formatChanges } from './format-changes'

const ROUTE = '/sample/$key'

type Search = NonNullable<Contract['screens']['screens'][number]['bindings'][number]['search']>

type Parameter = Search['properties'][string]

/** A parameter that a page sets: its enum chosen by a control, and one control per value. */
const TAB: Parameter = {
  type: 'string',
  enum: ['a', 'b'],
  'x-perch': {
    control: 'sample.mode-select',
    values: { a: { control: 'sample.a-button' }, b: { control: 'sample.b-button' } },
  },
}

const TAB_WORDS = `type "string", enum ["a","b"], control "sample.mode-select", values {"a":{"control":"sample.a-button"},"b":{"control":"sample.b-button"}}`

/** The fixture contract (its route has no search) with `properties` as the search of its route. */
function routeWith(properties: Search['properties'], required: string[] = []): Contract {
  const contract = fixtureContract()
  const binding = contract.screens.screens[0]?.bindings[0]

  if (binding === undefined) {
    throw new Error('the fixture has no binding')
  }

  binding.search = {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  }

  return contract
}

/** The fixture contract whose route has the one parameter `sort`, as `sort` gives it. */
const sorting = (sort: Parameter, required = false): Contract =>
  routeWith({ sort }, required ? ['sort'] : [])

const NONE = { added: [], removed: [], changed: [] }

describe('diffContracts and the search of a route', () => {
  it('lists none for a contract against itself, nor for a description alone', () => {
    const before = sorting({ type: 'string', description: 'The order.' })
    const after = sorting({ type: 'string', description: 'How the list is ordered.' })

    expect(diffContracts(before, before).routeSearch).toEqual(NONE)
    expect(diffContracts(before, after).routeSearch).toEqual(NONE)
    expect(formatChanges(diffContracts(before, before))).toBe('contract changes: none')
  })
  it('lists a parameter added or removed, with what it constrains', () => {
    const before = fixtureContract()
    const after = sorting({ type: 'string', enum: ['asc', 'desc'], default: 'asc' }, true)
    const line = `${ROUTE} search sort: type "string", enum ["asc","desc"], default "asc", required true`

    expect(diffContracts(before, after).routeSearch).toEqual({
      added: [line],
      removed: [],
      changed: [],
    })
    expect(diffContracts(after, before).routeSearch).toEqual({
      added: [],
      removed: [line],
      changed: [],
    })
  })
  it('lists one line naming the route, the parameter and the constraint that changed', () => {
    const before = sorting({ type: 'string', minLength: 1, maxLength: 10, pattern: '^[a-z]+$' })
    const after = sorting({ type: 'string', minLength: 1, maxLength: 20 })

    expect(diffContracts(before, after).routeSearch).toEqual({
      added: [],
      removed: [],
      changed: [
        `${ROUTE} search sort maxLength 10 -> 20`,
        `${ROUTE} search sort pattern "^[a-z]+$" -> none`,
      ],
    })
  })
  it('tells apart a type, a default, an example and a bound that print alike as text', () => {
    const before = sorting({ type: 'integer', default: 1, examples: [1], minimum: 1 })
    const after = sorting({ type: 'number', default: '1', examples: ['1'], minimum: 0 })

    expect(diffContracts(before, after).routeSearch.changed).toEqual([
      `${ROUTE} search sort default 1 -> "1"`,
      `${ROUTE} search sort examples [1] -> ["1"]`,
      `${ROUTE} search sort minimum 1 -> 0`,
      `${ROUTE} search sort type "integer" -> "number"`,
    ])
  })
  it('tells apart enums that print alike as text: one member with a comma, and two', () => {
    const before = sorting({ type: 'string', enum: ['a, b'] })
    const after = sorting({ type: 'string', enum: ['a', 'b'] })

    expect(diffContracts(before, after).routeSearch.changed).toEqual([
      `${ROUTE} search sort enum ["a, b"] -> ["a","b"]`,
    ])
  })
  it('lists a parameter that comes to be required, and one that stops being', () => {
    const before = sorting({ type: 'string' })
    const after = sorting({ type: 'string' }, true)

    expect(diffContracts(before, after).routeSearch.changed).toEqual([
      `${ROUTE} search sort required none -> true`,
    ])
    expect(diffContracts(after, before).routeSearch.changed).toEqual([
      `${ROUTE} search sort required true -> none`,
    ])
  })
  it("lists a key added, changed and removed, the key being the screen's", () => {
    const keyed = (key: string | undefined): Contract =>
      sorting({ type: 'string', ...(key === undefined ? {} : { 'x-perch': { key } }) })

    expect(diffContracts(keyed(undefined), keyed('sort-invalid')).routeSearch.changed).toEqual([
      `${ROUTE} search sort key none -> "sort-invalid"`,
    ])
    expect(diffContracts(keyed('sort-invalid'), keyed('sort-expired')).routeSearch.changed).toEqual(
      [`${ROUTE} search sort key "sort-invalid" -> "sort-expired"`],
    )
    expect(diffContracts(keyed('sort-invalid'), keyed(undefined)).routeSearch.changed).toEqual([
      `${ROUTE} search sort key "sort-invalid" -> none`,
    ])
  })
  it('lists the control of a parameter, and the control of one of its values, changed', () => {
    const after = routeWith({
      tab: {
        ...TAB,
        'x-perch': {
          control: 'sample.tab-select',
          values: { a: { control: 'sample.a-button' }, b: { control: 'sample.other-button' } },
        },
      },
    })

    expect(diffContracts(routeWith({ tab: TAB }), after).routeSearch.changed).toEqual([
      `${ROUTE} search tab control "sample.mode-select" -> "sample.tab-select"`,
      `${ROUTE} search tab values {"a":{"control":"sample.a-button"},"b":{"control":"sample.b-button"}} -> {"a":{"control":"sample.a-button"},"b":{"control":"sample.other-button"}}`,
    ])
  })
  it('leaves out the note of a value, which is prose', () => {
    const after = routeWith({
      tab: {
        ...TAB,
        'x-perch': {
          control: 'sample.mode-select',
          values: {
            a: { control: 'sample.a-button', note: 'Shows the first tab.' },
            b: { control: 'sample.b-button' },
          },
        },
      },
    })

    expect(diffContracts(routeWith({ tab: TAB }), after).routeSearch).toEqual(NONE)
  })
  it('lists every parameter of a route added or removed whole', () => {
    const before = routeWith({ tab: TAB })
    const after = routeWith({ tab: TAB })
    const [screen] = after.screens.screens
    const [binding] = screen?.bindings ?? []

    if (binding === undefined) {
      throw new Error('the fixture has no binding')
    }

    screen?.bindings.push({ ...structuredClone(binding), path: '/other/$key' })

    const route = `/other/$key search tab: ${TAB_WORDS}`

    expect(diffContracts(before, after).routeSearch).toEqual({
      added: [route],
      removed: [],
      changed: [],
    })
    expect(diffContracts(after, before).routeSearch).toEqual({
      added: [],
      removed: [route],
      changed: [],
    })
  })
  it('prints the parameters added, removed and changed', () => {
    const before = routeWith({ sort: { type: 'string', maxLength: 10 }, tab: TAB })
    const after = routeWith({
      page: { type: 'integer', minimum: 1 },
      sort: { type: 'string', maxLength: 20 },
    })

    expect(formatChanges(diffContracts(before, after)).split('\n')).toEqual([
      'contract changes: 1 route search parameter added, 1 route search parameter removed, 1 route search parameter changed',
      `route search parameters added: ${ROUTE} search page: type "integer", minimum 1`,
      `route search parameters removed: ${ROUTE} search tab: ${TAB_WORDS}`,
      `route search parameters changed: ${ROUTE} search sort maxLength 10 -> 20`,
    ])
  })
})

describe('diffContracts and a search parameter a mail link derives', () => {
  const roots: string[] = []

  /** The repository at `version`, the landing's parameter `written` or left out, its platform file edited by `edit`. */
  function landing(version: number, written: boolean, edit = (text: string): string => text) {
    const root = mkdtempSync(join(tmpdir(), 'ui-contract-search-changes-'))

    roots.push(root)
    writeMailLinkRepository(root, version, written)
    writeFileSync(join(root, PLATFORM_FILE), edit(readFileSync(join(root, PLATFORM_FILE), 'utf8')))

    return root
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists on the route the bound a platform value changes, which no file of the screen writes', () => {
    const before = landing(4, false)
    const after = landing(4, false, (text) => text.replace('maxLength: 4096', 'maxLength: 100'))
    const changes = diffContracts(contractAt(before), contractAt(after))

    expect(readFileSync(join(after, LANDING_FILE), 'utf8')).not.toContain('maxLength')
    expect(changes.values.changed).toEqual(['token maxLength 4096 -> 100'])
    expect(changes.routeSearch).toEqual({
      added: [],
      removed: [],
      changed: ['/landing search token maxLength 4096 -> 100'],
    })
  })
  it('lists on the route the key that a reordered list of codes moves', () => {
    const before = landing(4, false)
    const after = landing(4, false, (text) =>
      text.replace(
        '        codes: [ link-invalid, link-expired ]',
        '        codes: [ link-expired, link-invalid ]',
      ),
    )
    const changes = diffContracts(contractAt(before), contractAt(after))

    expect(readFileSync(join(after, LANDING_FILE), 'utf8')).not.toContain('x-perch')
    expect(changes.routeSearch).toEqual({
      added: [],
      removed: [],
      changed: ['/landing search token key "link-invalid" -> "link-expired"'],
    })
  })
  it('lists as added, with its key, the parameter the version 4 derives on a route that wrote none', () => {
    const before = contractAt(landing(3, false))
    const after = contractAt(landing(4, false))

    expect(diffContracts(before, after).routeSearch).toEqual({
      added: [
        '/landing search token: type "string", minLength 1, maxLength 4096, examples ["token-0123456789abcdef"], key "link-invalid"',
      ],
      removed: [],
      changed: [],
    })
  })
  it('lists the key alone when the version 4 derives what the version 3 file wrote', () => {
    const written = contractAt(landing(3, true))
    const bare = contractAt(landing(4, false))

    expect(diffContracts(written, bare).routeSearch).toEqual({
      added: [],
      removed: [],
      changed: ['/landing search token key none -> "link-invalid"'],
    })
    expect(diffContracts(bare, bare).routeSearch.changed).toEqual([])
  })
})

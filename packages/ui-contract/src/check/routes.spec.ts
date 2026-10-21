import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { sampleContract, screenIn } from './contract.fixture'
import { parseRoutePath, routesProblems } from './routes'

describe('parseRoutePath', () => {
  it('reads the four kinds of segment of the router', () => {
    expect(parseRoutePath('/')).toEqual({ segments: [], problems: [] })
    expect(parseRoutePath('/org')).toEqual({
      segments: [{ kind: 'static', name: 'org' }],
      problems: [],
    })
    expect(parseRoutePath('/org/$key').segments).toEqual([
      { kind: 'static', name: 'org' },
      { kind: 'param', name: 'key' },
    ])
    expect(parseRoutePath('/org/{-$tab}').segments).toEqual([
      { kind: 'static', name: 'org' },
      { kind: 'optional', name: 'tab' },
    ])
    expect(parseRoutePath('/files/$')).toEqual({
      segments: [
        { kind: 'static', name: 'files' },
        { kind: 'splat', name: '_splat' },
      ],
      problems: [],
    })
  })
  it('refuses a path without a leading slash', () => {
    expect(parseRoutePath('org').problems).toEqual(['a route path starts with "/"'])
  })
  it("refuses a parameter that is not in the router's syntax", () => {
    expect(parseRoutePath('/org/:key').problems).toEqual([
      '":key" is not a segment of the router (static, $param, {-$param} or $)',
    ])
  })
  it('refuses a segment after the splat', () => {
    expect(parseRoutePath('/org/$/members').problems).toEqual(['the splat "$" is the last segment'])
  })
  it('refuses an empty segment and a parameter named twice', () => {
    expect(parseRoutePath('/org//x').problems).toEqual(['an empty segment'])
    expect(parseRoutePath('/org/').problems).toEqual(['an empty segment'])
    expect(parseRoutePath('/a/$key/{-$key}').problems).toEqual(['parameter "key" appears twice'])
  })
})

const printed = (contract = sampleContract()): string[] =>
  routesProblems(contract).map(formatProblem)

describe('routesProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('reports a binding path that does not parse', () => {
    const contract = sampleContract()
    const binding = screenIn(contract, 'sample').bindings[0]

    Object.assign(binding ?? {}, { path: '/sample/:key' })

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: screens[1].bindings[0].path: ":key" is not a segment of the router (static, $param, {-$param} or $)',
      'contract/screens.json:1: screens[1].bindings[0].params.properties.key: "key" is not a parameter of the path "/sample/:key"',
    ])
  })
  it('wants every path parameter in params and every params property in the path', () => {
    const contract = sampleContract()
    const binding = screenIn(contract, 'sample').bindings[0]

    Object.assign(binding ?? {}, { path: '/sample/{-$tab}' })

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: screens[1].bindings[0].params: the path parameter "tab" is not a property of params',
      'contract/screens.json:1: screens[1].bindings[0].params.properties.key: "key" is not a parameter of the path "/sample/{-$tab}"',
    ])
  })
  it('wants params when the path has parameters', () => {
    const contract = sampleContract()
    const binding = screenIn(contract, 'sample').bindings[0]

    if (binding) {
      delete binding.params
    }

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: screens[1].bindings[0].params: the path parameter "key" is not a property of params',
    ])
  })
  it('wants every path bound once', () => {
    const contract = sampleContract()
    const shell = screenIn(contract, 'app-shell')
    const [binding] = screenIn(contract, 'sample').bindings

    if (binding) {
      shell.bindings = [structuredClone(binding)]
    }

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: screens[1].bindings[0].path: "/sample/$key" is also bound on screen "app-shell"',
    ])
  })
})

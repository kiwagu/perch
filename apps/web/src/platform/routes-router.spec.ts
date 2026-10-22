/**
 * The router itself accepts every binding of the UI contract: a location built from a
 * binding's path, with a sample value per parameter of that path and the least search its
 * schema accepts, matches the binding's route again with the same parameters, and its search
 * reads back with the schema's defaults applied. The parameters the binding declares are the
 * ones its path has. So a route is a state address: the same path with the same search
 * reaches the same state after a reload. A parameter's first example is its sample, before
 * any value the sampler builds; every sampled search satisfies the binding's schema; a
 * parameter the sampler builds no value of skips the binding's search case, named.
 */

import { join } from 'node:path'

import { trimPathRight } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import {
  type Binding,
  bindingSchema,
  formatProblem,
  loadScreens,
  parseRoutePath,
  validateAgainst,
} from '@workspace/ui-contract'
import { z } from '@workspace/zod'

import { modules } from '../modules'

import { type AppRouter, type Matched, matchAt, routerOf, SPLAT } from './__fixtures__/router'
import { defineModule } from './module'

const ROOT = join(import.meta.dirname, '../../../..')

/** The value a path parameter is built with. */
const PARAM_SAMPLE = 'sample-value'

/** The value a splat is built with: it spans segments. */
const SPLAT_SAMPLE = 'a/b'

type Value = string | number | boolean
type Search = Binding['search']
type Parameter = NonNullable<Search>['properties'][string]

/**
 * The path parameters a path is built with, named by the path itself, never by what a
 * binding declares: per `$param` and `{-$param}` the first example `params` gives it, else a
 * sample, and the splat's value under `_splat` when it ends in `$`; with an optional
 * parameter, also the form without it.
 */
function paramForms(path: string, params?: Binding['params']): Record<string, string>[] {
  const { segments } = parseRoutePath(path)
  const firstExample = (name: string): string | undefined => {
    const example = params?.properties[name]?.examples?.[0]

    return example === undefined ? undefined : String(example)
  }
  const present: Record<string, string> = Object.fromEntries(
    segments.flatMap(({ kind, name }) =>
      kind === 'static'
        ? []
        : [[name, kind === 'splat' ? SPLAT_SAMPLE : (firstExample(name) ?? PARAM_SAMPLE)] as const],
    ),
  )
  const optional = new Set(
    segments.filter(({ kind }) => kind === 'optional').map(({ name }) => name),
  )

  return optional.size === 0
    ? [present]
    : [present, Object.fromEntries(Object.entries(present).filter(([name]) => !optional.has(name)))]
}

/**
 * A number within a parameter's `minimum` and `maximum`, whole for an `integer`: 0 when the
 * bounds hold it, else the bound nearest to 0. (A binding's flat schema has no exclusive
 * bounds: it refuses them.)
 */
function numberWithin(parameter: Parameter): number {
  const whole = parameter.type === 'integer'
  const lowest = parameter.minimum ?? Number.NEGATIVE_INFINITY
  const highest = parameter.maximum ?? Number.POSITIVE_INFINITY

  return Math.min(
    Math.max(0, whole ? Math.ceil(lowest) : lowest),
    whole ? Math.floor(highest) : highest,
  )
}

/** Plain characters, `^draft$` (anchors optional): the value is the pattern itself. */
const LITERAL = /^\^?([\w-]+)\$?$/

/**
 * One character class repeated, `^[a-z]+$` or `^\d{3}$` (anchors optional): `\d` or `\w`, or
 * the first character of a class that is not negated, then the quantifier and its bounds.
 */
const REPEATED = /^\^?(?:\\([dw])|\[([^\]^\\])[^\]]*\])(\+|\*|\{(\d+)(,(\d*))?\})\$?$/

/** A character of each shorthand class. */
const SHORTHAND: Readonly<Record<string, string>> = { d: '0', w: 'a' }

/** The repetitions a quantifier allows: `+`, `*`, `{n}`, `{n,}` or `{n,m}`. */
function repetitions(quantifier: string, fewest = '0', range?: string, most = ''): number[] {
  if (quantifier === '+') {
    return [1, Number.POSITIVE_INFINITY]
  }

  if (range === undefined) {
    return quantifier === '*' ? [0, Number.POSITIVE_INFINITY] : [Number(fewest), Number(fewest)]
  }

  return [Number(fewest), most === '' ? Number.POSITIVE_INFINITY : Number(most)]
}

/**
 * The shortest length a string takes within `[fewest, most]` and the parameter's `minLength`
 * and `maxLength`: at least 1 unless `minLength` allows 0.
 */
function lengthWithin(parameter: Parameter, fewest = 0, most = Number.POSITIVE_INFINITY): number {
  return Math.min(
    Math.max(fewest, parameter.minLength ?? 1),
    most,
    parameter.maxLength ?? Number.POSITIVE_INFINITY,
  )
}

/**
 * A string of the parameter's lengths that its `pattern` accepts, when the pattern is plain
 * characters or one class repeated; none for any other pattern.
 */
function stringOf(parameter: Parameter): string | undefined {
  const { pattern } = parameter

  if (pattern === undefined) {
    return 'a'.repeat(lengthWithin(parameter))
  }

  const literal = LITERAL.exec(pattern)?.[1]

  if (literal !== undefined) {
    return literal
  }

  const [, shorthand, first, quantifier = '', fewest, range, most] = REPEATED.exec(pattern) ?? []
  const character = shorthand === undefined ? first : SHORTHAND[shorthand]

  if (character === undefined) {
    return undefined
  }

  const [low, high] = repetitions(quantifier, fewest, range, most)

  return character.repeat(lengthWithin(parameter, low, high))
}

/** A value of a parameter: its first example, else the first of its `enum`, else one of its type. */
function sampleOf(parameter: Parameter): Value | undefined {
  const byType: Readonly<Record<Parameter['type'], Value | undefined>> = {
    string: stringOf(parameter),
    integer: numberWithin(parameter),
    number: numberWithin(parameter),
    boolean: true,
  }

  return parameter.examples?.[0] ?? parameter.enum?.[0] ?? byType[parameter.type]
}

/**
 * The least search a schema accepts, a value per required parameter without a default, each
 * one checked against its own schema; or, when the sampler builds no value a parameter's
 * schema accepts, which parameter and why.
 */
function minimalSearch(
  search: Search,
): { readonly search: Record<string, Value> } | { readonly unsampled: string } {
  const required = new Set(search?.required ?? [])
  const needed = Object.entries(search?.properties ?? {}).filter(
    ([name, parameter]) => required.has(name) && parameter.default === undefined,
  )
  const sent: Record<string, Value> = {}

  for (const [name, parameter] of needed) {
    const value = sampleOf(parameter)

    if (value === undefined || validateAgainst(name, parameter, value).length > 0) {
      const of = parameter.pattern === undefined ? 'its schema' : `the pattern ${parameter.pattern}`

      return { unsampled: `no value of \`${name}\` derived for ${of}` }
    }

    sent[name] = value
  }

  return { search: sent }
}

/** The search a route reads from the one sent: the schema's defaults, then the values sent. */
function searchRead(search: Search, sent: Record<string, Value>): Record<string, Value> {
  const defaults = Object.entries(search?.properties ?? {}).flatMap(([name, parameter]) =>
    parameter.default === undefined ? [] : [[name, parameter.default] as const],
  )

  return { ...Object.fromEntries(defaults), ...sent }
}

/** What the router answers for a location it built: the location, then what it matches. */
interface Reached extends Matched {
  readonly pathname: string
  readonly searchStr: string
}

/**
 * Where the router takes a path: the location it builds with the parameters and the search,
 * then the deepest route it matches for that location, its search read back from the URL's
 * text the way a reload reads it. A refused search is reported, not thrown, so the path
 * checks do not depend on it.
 */
function visit(
  router: AppRouter,
  path: string,
  params: Record<string, string>,
  search: Record<string, Value>,
): Reached {
  const location = router.buildLocation({ to: path, params, search })

  return {
    pathname: location.pathname,
    searchStr: location.searchStr,
    ...matchAt(router, location.pathname, location.searchStr),
  }
}

/**
 * A binding's path parameters three ways, each on its own: as its path names them (`_splat`
 * for a splat), as its `params` declares them, and as the router reports them for the path
 * built from the path's own.
 */
function parameterNames(
  router: AppRouter,
  binding: Binding,
): { path: string[]; declared: string[]; reported: string[] } {
  const [built = {}] = paramForms(binding.path, binding.params)
  const reached = visit(router, binding.path, built, {})

  return {
    path: Object.keys(built).sort(),
    declared: Object.keys(binding.params?.properties ?? {}).sort(),
    reported: Object.keys(reached.params).sort(),
  }
}

/**
 * The search case of a binding: the least search its schema accepts satisfies that schema
 * (Ajv), the router takes it without refusal and reads it back with the defaults applied. A
 * parameter the sampler builds no value of skips the case, the note naming it.
 */
function searchCase(router: AppRouter, binding: Binding, skip: (note: string) => never): void {
  const sample = minimalSearch(binding.search)

  if ('unsampled' in sample) {
    skip(`${binding.path}: ${sample.unsampled}`)
  }

  const [present = {}] = paramForms(binding.path, binding.params)
  const reached = visit(router, binding.path, present, sample.search)
  const problems = binding.search
    ? validateAgainst(binding.path, binding.search, sample.search)
    : []

  expect(problems.map(formatProblem), `the search sampled for ${binding.path}`).toEqual([])
  expect(reached.searchError, `the refusal of ${reached.searchStr}`).toBeUndefined()
  expect(reached.search, `the search ${binding.path} reads back`).toEqual(
    searchRead(binding.search, sample.search),
  )
}

const { screens, problems } = loadScreens(ROOT)
const bindings: readonly (readonly [string, Binding])[] = (screens?.screens ?? [])
  .filter((screen) => screen.frame !== true)
  .flatMap((screen) => screen.bindings.map((binding) => [binding.path, binding] as const))
const router = routerOf(modules)

const Page = () => null

/** Routes of the forms the router's syntax has, which the contract does not all use yet. */
const SampleModule = defineModule({
  id: 'sample',
  declarations: { Page },
  routes: [
    { path: '/org/$key', page: 'Page' },
    { path: '/notes/{-$tab}', page: 'Page' },
    { path: '/files/$', page: 'Page' },
    {
      path: '/list',
      page: 'Page',
      search: z.object({ tab: z.enum(['a', 'b']).default('a'), page: z.int().min(1) }),
    },
    {
      path: '/range',
      page: 'Page',
      search: z.object({
        below: z.number().max(-2),
        between: z.int().min(-5).max(-1),
        around: z.int().min(-3).max(3),
        above: z.number().min(2.5),
      }),
    },
    {
      path: '/find',
      page: 'Page',
      search: z.object({
        q: z.string().max(5),
        name: z.string().min(3),
        slug: z.string().regex(/^[a-z]+$/),
        code: z.string().regex(/^\d{3}$/),
        kind: z.string().regex(/^draft$/),
      }),
    },
  ],
})

const sampleRouter = routerOf([SampleModule])

const stringParams = (name: string) => ({
  type: 'object',
  properties: { [name]: { type: 'string' } },
  additionalProperties: false,
})

describe('the round trip', () => {
  it('builds an optional parameter in both forms and a splat across segments', () => {
    const optional = bindingSchema.parse({
      path: '/notes/{-$tab}',
      roles: ['identity'],
      params: stringParams('tab'),
    })
    const splat = bindingSchema.parse({ path: '/files/$', roles: ['identity'] })

    expect(
      paramForms(optional.path).map((params) => visit(sampleRouter, optional.path, params, {})),
    ).toEqual([
      {
        pathname: '/notes/sample-value',
        searchStr: '',
        fullPath: '/notes/{-$tab}',
        params: { tab: 'sample-value' },
        search: {},
      },
      { pathname: '/notes', searchStr: '', fullPath: '/notes/{-$tab}', params: {}, search: {} },
    ])
    expect(
      paramForms(splat.path).map((params) => visit(sampleRouter, splat.path, params, {})),
    ).toEqual([
      {
        pathname: '/files/a/b',
        searchStr: '',
        fullPath: '/files/$',
        params: { _splat: 'a/b' },
        search: {},
      },
    ])
  })

  it('sends a value per required parameter and reads the defaults back', ({ skip }) => {
    const list = bindingSchema.parse({
      path: '/list',
      roles: ['identity'],
      search: {
        type: 'object',
        properties: {
          tab: { type: 'string', enum: ['a', 'b'], default: 'a' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['page'],
        additionalProperties: false,
      },
    })

    expect(minimalSearch(list.search)).toEqual({ search: { page: 1 } })
    expect(visit(sampleRouter, list.path, {}, { page: 1 })).toMatchObject({
      searchStr: '?page=1',
      search: { tab: 'a', page: 1 },
    })
    searchCase(sampleRouter, list, skip)
  })

  it('sends a number within the bounds of its schema', ({ skip }) => {
    const range = bindingSchema.parse({
      path: '/range',
      roles: ['identity'],
      search: {
        type: 'object',
        properties: {
          below: { type: 'number', maximum: -2 },
          between: { type: 'integer', minimum: -5, maximum: -1 },
          around: { type: 'integer', minimum: -3, maximum: 3 },
          above: { type: 'number', minimum: 2.5 },
        },
        required: ['below', 'between', 'around', 'above'],
        additionalProperties: false,
      },
    })

    expect(minimalSearch(range.search)).toEqual({
      search: { below: -2, between: -1, around: 0, above: 2.5 },
    })
    searchCase(sampleRouter, range, skip)
  })

  it('sends a string within the lengths and the pattern of its schema', ({ skip }) => {
    const find = bindingSchema.parse({
      path: '/find',
      roles: ['identity'],
      search: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 5 },
          name: { type: 'string', minLength: 3 },
          slug: { type: 'string', pattern: '^[a-z]+$' },
          code: { type: 'string', pattern: '^\\d{3}$' },
          kind: { type: 'string', pattern: '^draft$' },
        },
        required: ['q', 'name', 'slug', 'code', 'kind'],
        additionalProperties: false,
      },
    })

    expect(minimalSearch(find.search)).toEqual({
      search: { q: 'a', name: 'aaa', slug: 'a', code: '000', kind: 'draft' },
    })
    searchCase(sampleRouter, find, skip)
  })

  it('builds a parameter with its first example, before any sample', ({ skip }) => {
    const org = bindingSchema.parse({
      path: '/org/$key',
      roles: ['identity'],
      params: {
        type: 'object',
        properties: { key: { type: 'string', examples: ['org_01hzx9k2', 'org_01hzxa7q'] } },
        additionalProperties: false,
      },
    })
    const find = bindingSchema.parse({
      path: '/find',
      roles: ['identity'],
      search: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 5, examples: ['beta'] },
          name: { type: 'string', minLength: 3 },
          slug: { type: 'string', pattern: '^[a-z]+$' },
          code: { type: 'string', pattern: '^\\d{3}$', examples: ['123'] },
          kind: { type: 'string', pattern: '^draft$' },
        },
        required: ['q', 'name', 'slug', 'code', 'kind'],
        additionalProperties: false,
      },
    })

    expect(paramForms(org.path, org.params)).toEqual([{ key: 'org_01hzx9k2' }])
    expect(visit(sampleRouter, org.path, { key: 'org_01hzx9k2' }, {})).toMatchObject({
      pathname: '/org/org_01hzx9k2',
      params: { key: 'org_01hzx9k2' },
    })
    expect(minimalSearch(find.search)).toEqual({
      search: { q: 'beta', name: 'aaa', slug: 'a', code: '123', kind: 'draft' },
    })
    searchCase(sampleRouter, find, skip)
  })

  /** A pattern beyond plain characters and one repeated class. */
  const odd = bindingSchema.parse({
    path: '/odd',
    roles: ['identity'],
    search: {
      type: 'object',
      properties: { q: { type: 'string', pattern: '^[a-z]+-\\d+$' } },
      required: ['q'],
      additionalProperties: false,
    },
  })

  it('names the parameter and the pattern it derives no value of', () => {
    expect(minimalSearch(odd.search)).toEqual({
      unsampled: 'no value of `q` derived for the pattern ^[a-z]+-\\d+$',
    })
  })

  it('skips the search case of a pattern it derives no value of', ({ skip }) => {
    searchCase(sampleRouter, odd, skip)
  })

  it('tells a path parameter the binding forgot or invented', () => {
    const forgot = bindingSchema.parse({ path: '/org/$key', roles: ['identity'] })
    const forgotOptional = bindingSchema.parse({ path: '/notes/{-$tab}', roles: ['identity'] })
    const invented = bindingSchema.parse({
      path: '/org/$key',
      roles: ['identity'],
      params: {
        type: 'object',
        properties: { key: { type: 'string' }, tab: { type: 'string' } },
        additionalProperties: false,
      },
    })

    expect(parameterNames(sampleRouter, forgot)).toEqual({
      path: ['key'],
      declared: [],
      reported: ['key'],
    })
    expect(parameterNames(sampleRouter, forgotOptional)).toEqual({
      path: ['tab'],
      declared: [],
      reported: ['tab'],
    })
    expect(parameterNames(sampleRouter, invented)).toEqual({
      path: ['key'],
      declared: ['key', 'tab'],
      reported: ['key'],
    })
  })

  it('tells a splat the binding left out of its path', () => {
    const splat = bindingSchema.parse({ path: '/files/$', roles: ['identity'] })
    const unsplat = bindingSchema.parse({ path: '/files', roles: ['identity'] })

    expect(parameterNames(sampleRouter, splat)).toEqual({
      path: ['_splat'],
      declared: [],
      reported: ['_splat'],
    })
    expect(visit(sampleRouter, unsplat.path, {}, {})).toMatchObject({ fullPath: '/files/$' })
    expect(parameterNames(sampleRouter, unsplat)).toEqual({
      path: [],
      declared: [],
      reported: ['_splat'],
    })
  })
})

describe('the bindings of the contract on the router', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(bindings.length).toBeGreaterThan(0)
  })

  it.each(bindings)('%s matches its route again with its parameters', (path, binding) => {
    for (const params of paramForms(path, binding.params)) {
      const reached = visit(router, path, params, {})

      expect(trimPathRight(reached.fullPath ?? ''), `the route ${reached.pathname} matches`).toBe(
        trimPathRight(path),
      )
      expect(reached.params, `the parameters ${reached.pathname} matches`).toEqual(params)
    }
  })

  it.each(bindings)('%s declares the path parameters the router reports', (path, binding) => {
    const names = parameterNames(router, binding)

    expect(names.reported, `the parameters the router reports for ${path}`).toEqual(names.path)
    // A splat is declared by its `$` alone: a `params` property cannot be named `_splat`.
    expect(names.declared, `the params ${path} declares`).toEqual(
      names.path.filter((name) => name !== SPLAT),
    )
  })

  it.for(bindings)(
    '%s builds its search and reads it back with the defaults',
    ([, binding], { skip }) => {
      searchCase(router, binding, skip)
    },
  )
})

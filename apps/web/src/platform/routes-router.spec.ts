/**
 * The router itself accepts every binding of the UI contract: a location built from a
 * binding's path, with a sample value per parameter of that path and the least search its
 * schema accepts, matches the binding's route again with the same parameters, and its search
 * reads back with the schema's defaults applied. The parameters the binding declares are the
 * ones its path has. So a route is a state address: the same path with the same search
 * reaches the same state after a reload.
 */

import { join } from 'node:path'

import { createMemoryHistory, trimPathRight } from '@tanstack/react-router'
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

import { defineModule, type ModuleDef } from './module'
import { createAppRouter } from './router'

const ROOT = join(import.meta.dirname, '../../../..')

/** The value a path parameter is built with. */
const PARAM_SAMPLE = 'sample-value'

/** The value a splat is built with: it spans segments. */
const SPLAT_SAMPLE = 'a/b'

/** The router's name for the value of a splat. */
const SPLAT = '_splat'

/** The router reports a splat's value under `_splat` and again under `*`, its older name. */
const SPLAT_ALIAS = '*'

type Value = string | number | boolean
type Search = Binding['search']
type Parameter = NonNullable<Search>['properties'][string]

/** A router of `of` on a memory history, with nobody signed in; nothing renders it. */
function routerOf(of: readonly ModuleDef[]) {
  return createAppRouter({
    modules: of,
    session: { current: () => undefined, subscribe: () => () => {} },
    layout: () => null,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

/**
 * The path parameters a path is built with, taken from the path itself, never from what a
 * binding declares: a sample per `$param` and `{-$param}`, and the splat's value under
 * `_splat` when it ends in `$`; with an optional parameter, also the form without it.
 */
function paramForms(path: string): Record<string, string>[] {
  const { segments } = parseRoutePath(path)
  const present: Record<string, string> = Object.fromEntries(
    segments.flatMap(({ kind, name }) =>
      kind === 'static' ? [] : [[name, kind === 'splat' ? SPLAT_SAMPLE : PARAM_SAMPLE] as const],
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
 * bounds or `examples`: it refuses them.)
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

/** A value of a parameter's type, the first of its `enum` when it has one. */
function sampleOf(parameter: Parameter): Value {
  const byType: Readonly<Record<Parameter['type'], Value>> = {
    string: PARAM_SAMPLE,
    integer: numberWithin(parameter),
    number: numberWithin(parameter),
    boolean: true,
  }

  return parameter.enum?.[0] ?? byType[parameter.type]
}

/** The least search a schema accepts: a value per required parameter without a default. */
function minimalSearch(search: Search): Record<string, Value> {
  const required = new Set(search?.required ?? [])

  return Object.fromEntries(
    Object.entries(search?.properties ?? {})
      .filter(([name, parameter]) => required.has(name) && parameter.default === undefined)
      .map(([name, parameter]) => [name, sampleOf(parameter)]),
  )
}

/** The search a route reads from the least one: the schema's defaults and the values sent. */
function searchRead(search: Search): Record<string, Value> {
  const defaults = Object.entries(search?.properties ?? {}).flatMap(([name, parameter]) =>
    parameter.default === undefined ? [] : [[name, parameter.default] as const],
  )

  return { ...Object.fromEntries(defaults), ...minimalSearch(search) }
}

/** The parameters of a match, without the splat's older name when it repeats `_splat`. */
function paramsOf(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { [SPLAT_ALIAS]: alias, ...named } = params

  return alias === named[SPLAT] ? named : { ...params }
}

/**
 * The fields of a route match this spec reads: the router types them `any`, its route tree
 * being built at runtime.
 */
interface Matched {
  readonly fullPath: string
  readonly params: Readonly<Record<string, unknown>>
  readonly search: Readonly<Record<string, unknown>>
}

/** What the router answers for a location it built. */
interface Reached {
  readonly pathname: string
  readonly searchStr: string
  /** The full path of the deepest route the location matches. */
  readonly fullPath: string | undefined
  readonly params: Record<string, unknown>
  readonly search: Record<string, unknown>
}

/**
 * Where the router takes a path: the location it builds with the parameters and the search,
 * then the deepest route it matches for that location, its search read back from the URL's
 * text the way a reload reads it. A search the route refuses throws.
 */
function visit(
  router: ReturnType<typeof routerOf>,
  path: string,
  params: Record<string, string>,
  search: Record<string, Value>,
): Reached {
  const location = router.buildLocation({ to: path, params, search })
  const match: Matched | undefined = router
    .matchRoutes(location.pathname, router.options.parseSearch(location.searchStr), {
      throwOnError: true,
    })
    .at(-1)

  return {
    pathname: location.pathname,
    searchStr: location.searchStr,
    fullPath: match?.fullPath,
    params: paramsOf(match?.params ?? {}),
    search: { ...match?.search },
  }
}

/**
 * A binding's path parameters three ways, each on its own: as its path names them (`_splat`
 * for a splat), as its `params` declares them, and as the router reports them for the path
 * built from the path's own.
 */
function parameterNames(
  router: ReturnType<typeof routerOf>,
  binding: Binding,
): { path: string[]; declared: string[]; reported: string[] } {
  const [built = {}] = paramForms(binding.path)
  const reached = visit(router, binding.path, built, minimalSearch(binding.search))

  return {
    path: Object.keys(built).sort(),
    declared: Object.keys(binding.params?.properties ?? {}).sort(),
    reported: Object.keys(reached.params).sort(),
  }
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

  it('sends a value per required parameter and reads the defaults back', () => {
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

    expect(minimalSearch(list.search)).toEqual({ page: 1 })
    expect(visit(sampleRouter, list.path, {}, minimalSearch(list.search))).toMatchObject({
      searchStr: '?page=1',
      search: searchRead(list.search),
    })
    expect(searchRead(list.search)).toEqual({ tab: 'a', page: 1 })
  })

  it('sends a number within the bounds of its schema', () => {
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
    const search = minimalSearch(range.search)

    expect(search).toEqual({ below: -2, between: -1, around: 0, above: 2.5 })
    expect(validateAgainst('/range', range.search ?? {}, search).map(formatProblem)).toEqual([])
    expect(visit(sampleRouter, range.path, {}, search).search).toEqual(search)
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
    for (const params of paramForms(path)) {
      const reached = visit(router, path, params, minimalSearch(binding.search))

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

  it.each(bindings)('%s builds its search and reads it back with the defaults', (path, binding) => {
    const [present = {}] = paramForms(path)

    expect(visit(router, path, present, minimalSearch(binding.search)).search).toEqual(
      searchRead(binding.search),
    )
  })
})

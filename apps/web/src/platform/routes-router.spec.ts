/**
 * The router itself accepts every binding of the UI contract: a location built from a
 * binding's path, with a sample value per path parameter and the least search its schema
 * accepts, matches the binding's route again with the same parameters, and its search reads
 * back with the schema's defaults applied. So a route is a state address: the same path with
 * the same search reaches the same state after a reload.
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
 * The path parameters a binding is built with: a sample per property of its `params`, and
 * the splat's value when its path ends in one; with an optional parameter, also the form
 * without it.
 */
function paramForms(binding: Binding): Record<string, string>[] {
  const { segments } = parseRoutePath(binding.path)
  const present: Record<string, string> = Object.fromEntries([
    ...Object.keys(binding.params?.properties ?? {}).map((name) => [name, PARAM_SAMPLE] as const),
    ...segments.filter(({ kind }) => kind === 'splat').map(() => [SPLAT, SPLAT_SAMPLE] as const),
  ])
  const optional = new Set(
    segments.filter(({ kind }) => kind === 'optional').map(({ name }) => name),
  )

  return optional.size === 0
    ? [present]
    : [present, Object.fromEntries(Object.entries(present).filter(([name]) => !optional.has(name)))]
}

/** A value of a parameter's type, the first of its `enum` when it has one. */
function sampleOf(parameter: Parameter): Value {
  const byType: Readonly<Record<Parameter['type'], Value>> = {
    string: PARAM_SAMPLE,
    integer: parameter.minimum ?? 1,
    number: parameter.minimum ?? 1,
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
 * The path parameters a binding declares (`_splat` for a splat) and the ones the router
 * reports for the path built from them.
 */
function parameterNames(
  router: ReturnType<typeof routerOf>,
  binding: Binding,
): { declared: string[]; reported: string[] } {
  const [present = {}] = paramForms(binding)
  const reached = visit(router, binding.path, present, minimalSearch(binding.search))

  return { declared: Object.keys(present).sort(), reported: Object.keys(reached.params).sort() }
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
      paramForms(optional).map((params) => visit(sampleRouter, optional.path, params, {})),
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
    expect(paramForms(splat).map((params) => visit(sampleRouter, splat.path, params, {}))).toEqual([
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

  it('tells a path parameter the binding forgot or invented', () => {
    const forgot = bindingSchema.parse({ path: '/org/$key', roles: ['identity'] })
    const invented = bindingSchema.parse({
      path: '/org/$key',
      roles: ['identity'],
      params: {
        type: 'object',
        properties: { key: { type: 'string' }, tab: { type: 'string' } },
        additionalProperties: false,
      },
    })

    expect(parameterNames(sampleRouter, forgot)).toEqual({ declared: [], reported: ['key'] })
    expect(parameterNames(sampleRouter, invented)).toEqual({
      declared: ['key', 'tab'],
      reported: ['key'],
    })
  })
})

describe('the bindings of the contract on the router', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(bindings.length).toBeGreaterThan(0)
  })

  it.each(bindings)('%s matches its route again with its parameters', (path, binding) => {
    for (const params of paramForms(binding)) {
      const reached = visit(router, path, params, minimalSearch(binding.search))

      expect(trimPathRight(reached.fullPath ?? ''), `the route ${reached.pathname} matches`).toBe(
        trimPathRight(path),
      )
      expect(reached.params, `the parameters ${reached.pathname} matches`).toEqual(params)
    }
  })

  it.each(bindings)('%s has the path parameters of its binding', (path, binding) => {
    const { declared, reported } = parameterNames(router, binding)

    expect(reported, `the path parameters of ${path}`).toEqual(declared)
  })

  it.each(bindings)('%s builds its search and reads it back with the defaults', (path, binding) => {
    const [present = {}] = paramForms(binding)

    expect(visit(router, path, present, minimalSearch(binding.search)).search).toEqual(
      searchRead(binding.search),
    )
  })
})

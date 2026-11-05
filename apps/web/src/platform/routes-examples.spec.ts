/**
 * The example link of every binding (`exampleOf` of the UI contract) is a URL the router writes
 * and reads as the contract says. Its path is the one the router builds from the binding's
 * path with the example's parameters; its search is what the router's own `stringifySearch`
 * writes for the example's search (the example keeps every key at its default on purpose,
 * while the app's links leave out a value equal to its default: both reach the same state);
 * and matching the link, the router reaches the binding's route with those parameters and
 * that search, unrefused. The route tree the router builds equals the tree of the screen
 * folder (`routeTree`): the same routes under the same parents. On a branch the pre-commit hook
 * sets `CONTRACT_AHEAD=1`: a business commit may add or change a binding before its route, so
 * only the bindings the app has a route for are held to their example and the tree, each as the
 * contract says it now, or as it had it at the branch's merge base with `main`
 * (`CONTRACT_AHEAD_BASE`) while the route still equals that one (`heldTo` of
 * `__fixtures__/route-bindings.ts`); `bun run check` and `main` hold every binding as it is now.
 */

import { join } from 'node:path'

import { trimPathRight } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import {
  type Binding,
  bindingSchema,
  exampleOf,
  formatProblem,
  loadScreens,
  parseRoutePath,
  ROOT_ROUTE,
  routeTree,
} from '@workspace/ui-contract'
import { z } from '@workspace/zod'

import { modules } from '../modules'

import { AHEAD, bindingsAtBase, bindingsOf, heldBindings } from './__fixtures__/route-bindings'
import { type AppRouter, matchAt, routerOf, SPLAT } from './__fixtures__/router'
import { defineModule } from './module'
import { allModules } from './router'

const ROOT = join(import.meta.dirname, '../../../..')

/** The route the router starts on: it only sends the visitor on (`router.tsx`), no screen binds it. */
const START_PATH = '/'

/** A path segment no route of the application takes, for a root splat. */
const UNKNOWN_SEGMENT = 'no-such-page'

/** The parameters the router matches for an example: a splat the link leaves out is empty. */
function paramsMatched(binding: Binding, params: Readonly<Record<string, string>>) {
  const splat = parseRoutePath(binding.path).segments.some(({ kind }) => kind === 'splat')

  return splat ? { [SPLAT]: '', ...params } : params
}

/** The three readings of a binding's example on the router, each beside the contract's own. */
function exampleCase(router: AppRouter, binding: Binding): void {
  const { params, search, link } = exampleOf(binding)
  const [pathname = '', query] = link.split('?')
  const searchStr = query === undefined ? '' : `?${query}`
  // A root splat's example leaves its segment out, which is the start path, and the router's
  // start route outranks the splat there: the splat is matched at one segment instead.
  const shadowed = pathname === START_PATH && binding.path !== START_PATH
  const reached = matchAt(router, shadowed ? `/${UNKNOWN_SEGMENT}` : pathname, searchStr)

  expect(pathname, `the path of ${link}`).toBe(
    router.buildLocation({ to: binding.path, params }).href,
  )
  expect(searchStr, `the search of ${link}`).toBe(router.options.stringifySearch(search))
  expect(trimPathRight(reached.fullPath ?? ''), `the route ${link} matches`).toBe(
    trimPathRight(binding.path),
  )
  expect(reached.params, `the parameters ${link} matches`).toEqual(
    shadowed ? { [SPLAT]: UNKNOWN_SEGMENT, ...params } : paramsMatched(binding, params),
  )
  expect(reached.searchError, `the refusal of ${link}`).toBeUndefined()
  expect(reached.search, `the search ${link} reads back`).toEqual(search)
}

const Page = () => null

/** Routes of the forms the router's syntax has and of every kind of search value. */
const SampleModule = defineModule({
  id: 'sample',
  declarations: { Page },
  routes: [
    { path: '/things/$key', page: 'Page' },
    { path: '/notes/{-$tab}', page: 'Page' },
    { path: '/files/$', page: 'Page' },
    {
      path: '/list',
      page: 'Page',
      search: z.object({
        view: z.enum(['read', 'edit']).default('read'),
        pageSize: z.int().default(10),
        open: z.boolean().default(false),
        code: z
          .string()
          .regex(/^\d{3}$/)
          .optional(),
        q: z.string().optional(),
        filter: z.string().optional(),
        note: z.string().optional(),
      }),
    },
  ],
})

const sampleRouter = routerOf([SampleModule])

const flat = (properties: Readonly<Record<string, unknown>>) => ({
  type: 'object',
  properties,
  additionalProperties: false,
})

const sample = (fields: Readonly<Record<string, unknown>>): Binding =>
  bindingSchema.parse({ roles: ['identity'], ...fields })

describe('the example link on the router', () => {
  it('builds a path parameter from its example, encoded as the router encodes it', () => {
    const key = { type: 'string', examples: ['thg_01hzx9k2'] }
    const spaced = { type: 'string', examples: ['a b'] }

    exampleCase(sampleRouter, sample({ path: '/things/$key', params: flat({ key }) }))
    exampleCase(sampleRouter, sample({ path: '/things/$key', params: flat({ key: spaced }) }))
    expect(exampleOf(sample({ path: '/things/$key', params: flat({ key }) })).link).toBe(
      '/things/thg_01hzx9k2',
    )
  })

  it('builds a path parameter without an example within its schema', () => {
    const key = { type: 'string', pattern: '^thg_[a-z0-9]+$' }
    const things = sample({ path: '/things/$key', params: flat({ key }) })

    exampleCase(sampleRouter, things)
    expect(exampleOf(things).link).toBe('/things/thg_a')
  })

  it('never builds an empty path segment, even where its schema allows one', () => {
    const things = sample({
      path: '/things/$key',
      params: flat({ key: { type: 'string', minLength: 0 } }),
    })

    exampleCase(sampleRouter, things)
    expect(exampleOf(things).link).toBe('/things/a')
  })

  it('builds an optional segment with its example, and without one leaves it out', () => {
    const path = '/notes/{-$tab}'

    exampleCase(sampleRouter, sample({ path, params: flat({ tab: { type: 'string' } }) }))
    exampleCase(
      sampleRouter,
      sample({ path, params: flat({ tab: { type: 'string', examples: ['a'] } }) }),
    )
  })

  it('leaves out a splat, which takes no example', () => {
    exampleCase(sampleRouter, sample({ path: '/files/$' }))
  })

  it('writes every kind of search value as the router writes it', () => {
    const list = sample({
      path: '/list',
      search: flat({
        view: { type: 'string', enum: ['read', 'edit'], default: 'read' },
        pageSize: { type: 'integer', default: 10 },
        open: { type: 'boolean', default: false },
        code: { type: 'string', pattern: '^\\d{3}$', examples: ['123'] },
        q: { type: 'string', examples: ["two words!'()~*"] },
        filter: { type: 'string', examples: ['{"a":1}'] },
        note: { type: 'string' },
      }),
    })

    exampleCase(sampleRouter, list)
    expect(exampleOf(list).link).toBe(
      '/list?view=read&pageSize=10&open=false&code=%22123%22&q=two+words%21%27%28%29%7E*&filter=%22%7B%5C%22a%5C%22%3A1%7D%22',
    )
  })
})

const AT_BASE = bindingsAtBase(ROOT)
const { screens, problems } = loadScreens(ROOT)
// The bindings the app's routes are held to: on a branch only the routed ones, each as now or
// as at the base; `bun run check` and `main` hold every binding as it is now.
const bindings: readonly (readonly [string, Binding])[] = heldBindings(
  bindingsOf(screens?.screens ?? []),
  allModules(modules).flatMap((module) => module.routes),
  'bindings' in AT_BASE ? AT_BASE.bindings : [],
).map(({ binding }) => [binding.path, binding] as const)
const router = routerOf(modules)

describe('the example links of the contract on the router', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(bindings.length).toBeGreaterThan(0)
  })

  // A base that does not load fails here, once; the examples then wait for it.
  it("the contract at the branch's base loads", () => {
    expect('problem' in AT_BASE ? AT_BASE.problem : undefined).toBeUndefined()
  })

  it.skipIf('problem' in AT_BASE).each(bindings)(
    '%s is written and read as its example says',
    (_path, binding) => {
      exampleCase(router, binding)
    },
  )
})

/**
 * The fields of a route of the tree this spec reads: the router types its routes `any`, its
 * tree being built at runtime.
 */
interface TreeRoute {
  readonly fullPath: string
  readonly isRoot: boolean
  readonly parentRoute?: TreeRoute
}

/** A route of a tree with its parent, `__root` for the root, sorted for a comparison. */
const byPath = (routes: { path: string; parent: string }[]) =>
  routes.toSorted((a, b) => a.path.localeCompare(b.path, 'en'))

describe('the route tree', () => {
  it('equals the tree of the screen folder', () => {
    const built: TreeRoute[] = Object.values(router.routesById)
    const fromRouter = built
      .filter(({ isRoot, fullPath }) => !isRoot && fullPath !== START_PATH)
      .map(({ fullPath, parentRoute }) => ({
        path: trimPathRight(fullPath),
        parent:
          parentRoute === undefined || parentRoute.isRoot
            ? ROOT_ROUTE
            : trimPathRight(parentRoute.fullPath),
      }))
    const present = new Set(fromRouter.map(({ path }) => path))
    const fromFolder = routeTree(screens?.screens ?? [])
      .flatMap(({ path, parent }) => (parent === null ? [] : [{ path, parent }]))
      .filter(({ path }) => !AHEAD || present.has(path))

    expect(byPath(fromRouter)).toEqual(byPath(fromFolder))
  })
})

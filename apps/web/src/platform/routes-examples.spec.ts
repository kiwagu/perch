/**
 * The example link of every binding (`exampleOf` of the UI contract) is a URL the router writes
 * and reads as the contract says. Its path is the one the router builds from the binding's
 * path with the example's parameters; its search is what the router's own `stringifySearch`
 * writes for the example's search (the example keeps every key at its default on purpose,
 * while the app's links leave out a value equal to its default: both reach the same state);
 * and matching the link, the router reaches the binding's route with those parameters and
 * that search, unrefused. The route tree the router builds equals the tree of the screen
 * folder (`routeTree`): the same routes under the same parents.
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

import { type AppRouter, matchAt, routerOf, SPLAT } from './__fixtures__/router'
import { defineModule } from './module'

const ROOT = join(import.meta.dirname, '../../../..')

/** The route the router starts on: it only sends the visitor on (`router.tsx`), no screen binds it. */
const START_PATH = '/'

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
  const reached = matchAt(router, pathname, searchStr)

  expect(pathname, `the path of ${link}`).toBe(
    router.buildLocation({ to: binding.path, params }).href,
  )
  expect(searchStr, `the search of ${link}`).toBe(router.options.stringifySearch(search))
  expect(trimPathRight(reached.fullPath ?? ''), `the route ${link} matches`).toBe(
    trimPathRight(binding.path),
  )
  expect(reached.params, `the parameters ${link} matches`).toEqual(paramsMatched(binding, params))
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
        note: { type: 'string' },
      }),
    })

    exampleCase(sampleRouter, list)
    expect(exampleOf(list).link).toBe(
      '/list?view=read&pageSize=10&open=false&code=%22123%22&q=two+words%21%27%28%29%7E*',
    )
  })
})

const { screens, problems } = loadScreens(ROOT)
const bindings: readonly (readonly [string, Binding])[] = (screens?.screens ?? []).flatMap(
  (screen) => screen.bindings.map((binding) => [binding.path, binding] as const),
)
const router = routerOf(modules)

describe('the example links of the contract on the router', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(bindings.length).toBeGreaterThan(0)
  })

  it.each(bindings)('%s is written and read as its example says', (_path, binding) => {
    exampleCase(router, binding)
  })
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
    const fromFolder = routeTree(screens?.screens ?? []).flatMap(({ path, parent }) =>
      parent === null ? [] : [{ path, parent }],
    )

    expect(byPath(fromRouter)).toEqual(byPath(fromFolder))
  })
})

/**
 * The routes of the modules are the bindings of the UI contract, one to one: the
 * same path, guard, history and retained parameters, and the same search schema
 * once both sides are reduced to what the router enforces.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type Binding, flatJsonSchema, formatProblem, loadScreens } from '@workspace/ui-contract'
import { z } from '@workspace/zod'

import { modules } from '../modules'

import type { RouteDef } from './module'
import { allModules } from './router'

const ROOT = join(import.meta.dirname, '../../../..')

/**
 * Schema keywords the comparison leaves out: prose for the contract's readers
 * (`description`, `title`), the controls that set a parameter (`x-perch`), the
 * dialect (`$schema`, written by `z.toJSONSchema`, left out by a binding) and
 * `additionalProperties`: the contract pins it to `false` for its authors, while
 * the router's `z.object` is tolerant at runtime by design, an unknown search
 * parameter is not an error.
 */
const META_KEYWORDS = new Set([
  'description',
  'title',
  'x-perch',
  '$schema',
  'additionalProperties',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Zod writes the safe-integer range on every `z.int()`; a contract writes `{ "type": "integer" }`. */
const safeIntegerRange = (schema: Record<string, unknown>): boolean =>
  schema['minimum'] === Number.MIN_SAFE_INTEGER && schema['maximum'] === Number.MAX_SAFE_INTEGER

/**
 * A JSON Schema without the keywords above. Only the values of `properties` are
 * schemas themselves: its keys are parameter names (a parameter may be called
 * `title`) and are never filtered; every other keyword's value is compared as it is.
 */
function bare(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema
  }

  const dropRange = safeIntegerRange(schema)

  return Object.fromEntries(
    Object.entries(schema)
      .filter(([keyword]) => !META_KEYWORDS.has(keyword))
      .filter(([keyword]) => !(dropRange && (keyword === 'minimum' || keyword === 'maximum')))
      .map(([keyword, value]) =>
        keyword === 'properties' && isRecord(value)
          ? [keyword, Object.fromEntries(Object.entries(value).map(([name, p]) => [name, bare(p)]))]
          : [keyword, value],
      ),
  )
}

/**
 * The search a route enforces, on the input view: `required` lists what the URL
 * must carry, so a parameter with a default or an optional one is not in it.
 */
const routeSearch = (search: RouteDef['search']): unknown =>
  search ? bare(z.toJSONSchema(search, { target: 'draft-2020-12', io: 'input' })) : undefined

const { screens, problems } = loadScreens(ROOT)
const bindings: readonly { readonly screen: string; readonly binding: Binding }[] = (
  screens?.screens ?? []
)
  .filter((screen) => screen.frame !== true)
  .flatMap((screen) => screen.bindings.map((binding) => ({ screen: screen.id, binding })))
const routes: readonly RouteDef[] = [...new Set(allModules(modules))].flatMap(
  (module) => module.routes,
)

describe('the search comparison', () => {
  it('compares a parameter named like a dropped keyword', () => {
    const contract = flatJsonSchema.parse({
      type: 'object',
      properties: { title: { type: 'string', enum: ['a', 'b'] } },
      required: ['title'],
      additionalProperties: false,
    })

    expect(bare(contract)).not.toEqual(routeSearch(z.object({ title: z.enum(['a', 'c']) })))
    expect(bare(contract)).toEqual(routeSearch(z.object({ title: z.enum(['a', 'b']) })))
  })

  it('takes a parameter with a default as not required', () => {
    const contract = flatJsonSchema.parse({
      type: 'object',
      properties: { tab: { type: 'string', enum: ['a', 'b'], default: 'a' } },
      additionalProperties: false,
    })

    expect(bare(contract)).toEqual(routeSearch(z.object({ tab: z.enum(['a', 'b']).default('a') })))
  })

  it('takes an integer without bounds as the integer Zod writes', () => {
    const contract = flatJsonSchema.parse({
      type: 'object',
      properties: { page: { type: 'integer' } },
      required: ['page'],
      additionalProperties: false,
    })

    expect(bare(contract)).toEqual(routeSearch(z.object({ page: z.int() })))
    expect(bare(contract)).not.toEqual(routeSearch(z.object({ page: z.int().min(1) })))
  })
})

describe('the routes of the modules', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(routes.length).toBeGreaterThan(0)
  })

  it.each(routes.map((route) => [route.path, route] as const))(
    '%s equals its binding in the contract',
    (path, route) => {
      const matching = bindings.filter(({ binding }) => binding.path === path)

      expect(
        matching.map(({ screen }) => screen),
        `the screens with a binding at ${path}`,
      ).toHaveLength(1)

      const [found] = matching
      const screen = found?.screen ?? '(no screen)'

      expect(found?.binding.guard, `${screen}: guard of ${path}`).toBe(route.guard)
      expect(found?.binding.history, `${screen}: history of ${path}`).toBe(route.history ?? 'push')
      expect(found?.binding.retain, `${screen}: retain of ${path}`).toEqual(route.retain)
      expect(bare(found?.binding.search), `${screen}: search of ${path}`).toEqual(
        routeSearch(route.search),
      )
    },
  )

  it('cover every binding of the contract', () => {
    const paths = new Set(routes.map((route) => route.path))

    expect(
      bindings
        .filter(({ binding }) => !paths.has(binding.path))
        .map(({ screen, binding }) => `${screen}: ${binding.path}`),
    ).toEqual([])
  })
})

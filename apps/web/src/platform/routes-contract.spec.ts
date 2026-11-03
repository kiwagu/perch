/**
 * The routes of the modules are the bindings of the UI contract, one to one: the
 * same path, guard, history and retained parameters, and the same search schema
 * once both sides are reduced to what the router enforces (`__fixtures__/route-bindings.ts`).
 * On a branch the pre-commit hook sets `CONTRACT_AHEAD=1`: a business commit may add or change
 * a binding before its route, so a binding may wait for its route, and a route may still equal
 * its binding as the contract had it at the branch's merge base with `main`
 * (`CONTRACT_AHEAD_BASE`: the same screen, the same path); a route never lacks its binding, and
 * one that equals its binding neither now nor at the base fails. `bun run check` and `main` want
 * every binding routed as it is now.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bindingSchema, flatJsonSchema, formatProblem, loadScreens } from '@workspace/ui-contract'
import { z } from '@workspace/zod'

import { modules } from '../modules'

import {
  AHEAD,
  bare,
  bindingReading,
  bindingsAtBase,
  bindingsOf,
  heldBindings,
  heldTo,
  routeReading,
  routeSearch,
} from './__fixtures__/route-bindings'
import type { RouteDef } from './module'
import { allModules } from './router'

const ROOT = join(import.meta.dirname, '../../../..')

const AT_BASE = bindingsAtBase(ROOT)
const { screens, problems } = loadScreens(ROOT)
const bindings = bindingsOf((screens?.screens ?? []).filter((screen) => screen.frame !== true))
const routes: readonly RouteDef[] = [...new Set(allModules(modules))].flatMap(
  (module) => module.routes,
)
const held = heldBindings(bindings, routes, 'bindings' in AT_BASE ? AT_BASE.bindings : [])

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

  it('keeps the bound an integer sets and drops the safe limit Zod writes for the other', () => {
    const contract = flatJsonSchema.parse({
      type: 'object',
      properties: { page: { type: 'integer', minimum: 1 } },
      required: ['page'],
      additionalProperties: false,
    })

    expect(bare(contract)).toEqual(routeSearch(z.object({ page: z.int().min(1) })))
    expect(bare(contract)).not.toEqual(routeSearch(z.object({ page: z.int().min(2) })))
  })
})

describe('the binding a route is held to', () => {
  const page = 'Page'
  const searchOf = (properties: Readonly<Record<string, unknown>>) => ({
    type: 'object',
    properties,
    additionalProperties: false,
  })
  const was = {
    screen: 'sample',
    binding: bindingSchema.parse({ path: '/list', roles: ['identity'] }),
  }
  const now = {
    screen: 'sample',
    binding: bindingSchema.parse({
      path: '/list',
      roles: ['identity'],
      guard: 'guest',
      search: searchOf({ q: { type: 'string' } }),
    }),
  }

  it('is the binding now when the route equals it', () => {
    const route: RouteDef = {
      path: '/list',
      page,
      guard: 'guest',
      search: z.object({ q: z.string().optional() }),
    }

    expect(heldTo(route, now, [was])).toBe(now)
  })

  it('is the binding at the base when the route still equals that one', () => {
    const route: RouteDef = { path: '/list', page }

    expect(heldTo(route, now, [was])).toBe(was)
    expect(heldTo(route, now, [{ ...was, screen: 'other' }])).toBe(now)
    expect(
      heldTo(route, now, [
        { ...was, binding: bindingSchema.parse({ path: '/other', roles: ['identity'] }) },
      ]),
    ).toBe(now)
    expect(heldTo(route, now, [])).toBe(now)
  })

  it('is the binding now, which it fails, when the route equals neither', () => {
    const route: RouteDef = { path: '/list', page, guard: 'authenticated' }

    expect(heldTo(route, now, [was])).toBe(now)
    expect(bindingReading(now.binding)).not.toEqual(routeReading(route))
  })
})

describe('the routes of the modules', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(routes.length).toBeGreaterThan(0)
  })

  // A base that does not load fails here, once; the routes then wait for it.
  it("the contract at the branch's base loads", () => {
    expect('problem' in AT_BASE ? AT_BASE.problem : undefined).toBeUndefined()
  })

  it.skipIf('problem' in AT_BASE).each(routes.map((route) => [route.path, route] as const))(
    '%s equals its binding in the contract',
    (path, route) => {
      const matching = held.filter(({ binding }) => binding.path === path)

      expect(
        matching.map(({ screen }) => screen),
        `the screens with a binding at ${path}`,
      ).toHaveLength(1)

      const [found] = matching
      const screen = found?.screen ?? '(no screen)'
      const binding = found === undefined ? undefined : bindingReading(found.binding)
      const app = routeReading(route)

      expect(binding?.guard, `${screen}: guard of ${path}`).toBe(app.guard)
      expect(binding?.history, `${screen}: history of ${path}`).toBe(app.history)
      expect(binding?.retain, `${screen}: retain of ${path}`).toEqual(app.retain)
      expect(binding?.search, `${screen}: search of ${path}`).toEqual(app.search)
    },
  )

  it('cover every binding of the contract', () => {
    const paths = new Set(routes.map((route) => route.path))
    const unrouted = bindings
      .filter(({ binding }) => !paths.has(binding.path))
      .map(({ screen, binding }) => `${screen}: ${binding.path}`)

    expect(AHEAD ? [] : unrouted).toEqual([])
  })
})

/**
 * The routes of the modules are the bindings of the UI contract, one to one: the
 * same path, guard, history and retained parameters, and a search schema that is
 * the binding's `search` once its prose is gone.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type Binding, formatProblem, loadScreens } from '@workspace/ui-contract'
import { z } from '@workspace/zod'

import { modules } from '../modules'

import type { RouteDef } from './module'
import { allModules } from './router'

const ROOT = join(import.meta.dirname, '../../../..')

/**
 * Keys the contract carries for its readers and the router has no use for: prose
 * (`description`, `title`), the controls that set a parameter (`x-perch`) and the
 * dialect (`$schema`, which `z.toJSONSchema` writes and a binding leaves out).
 */
const META_KEYS = new Set(['description', 'title', 'x-perch', '$schema'])

/** The JSON value without its meta keys, at any depth. */
function stripMeta(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripMeta)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !META_KEYS.has(key))
        .map(([key, inner]) => [key, stripMeta(inner)]),
    )
  }

  return value
}

const { screens, problems } = loadScreens(ROOT)
const bindings: readonly Binding[] = (screens?.screens ?? []).flatMap((screen) => screen.bindings)
const routes: readonly RouteDef[] = [...new Set(allModules(modules))].flatMap(
  (module) => module.routes,
)

describe('the routes of the modules', () => {
  it('read a contract without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(routes.length).toBeGreaterThan(0)
  })

  it.each(routes.map((route) => [route.path, route] as const))(
    '%s equals its binding in the contract',
    (path, route) => {
      const matching = bindings.filter((binding) => binding.path === path)

      expect(matching).toHaveLength(1)

      const [binding] = matching

      expect(binding?.guard).toBe(route.guard)
      expect(binding?.history).toBe(route.history ?? 'push')
      expect(binding?.retain).toEqual(route.retain)
      expect(stripMeta(binding?.search)).toEqual(
        route.search
          ? stripMeta(z.toJSONSchema(route.search, { target: 'draft-2020-12' }))
          : undefined,
      )
    },
  )

  it('cover every binding of the contract', () => {
    const paths = new Set(routes.map((route) => route.path))

    expect(bindings.map((binding) => binding.path).filter((path) => !paths.has(path))).toEqual([])
  })
})

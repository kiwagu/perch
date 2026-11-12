/**
 * The bindings of the UI contract the app's routes are held to, for the specs that hold them
 * (`routes-contract`, `routes-router`, `routes-examples` and `routes-roles`). A route reads as its
 * binding once both are reduced to what the router enforces: the same guard, roles (as a set),
 * history, retained parameters and search schema. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1` and names the
 * branch's merge base with `main` (`CONTRACT_AHEAD_BASE`): a business commit may add or change
 * a binding before its route, so a binding may wait for its route, and a route that still reads
 * as its binding did at the base (the same screen, the same path) is held to that binding as it
 * was there. On `main` and in `bun run check` every binding is held as the contract says it now.
 */

import { type Binding, contractAt } from '@workspace/ui-contract'
import { sameValue } from '@workspace/ui-contract/machines'
import { z } from '@workspace/zod'

import type { RouteDef } from '../module'

/** On a branch the pre-commit hook sets it: the contract may run ahead of the app. */
export const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

/**
 * Schema keywords the comparison leaves out: prose for the contract's readers
 * (`description`, `title`), the fake values of its example links (`examples`), the
 * controls that set a parameter (`x-perch`), the dialect (`$schema`, written by
 * `z.toJSONSchema`, left out by a binding) and
 * `additionalProperties`: the contract pins it to `false` for its authors, while
 * the router's `z.object` is tolerant at runtime by design, an unknown search
 * parameter is not an error.
 */
const META_KEYWORDS = new Set([
  'description',
  'title',
  'examples',
  'x-perch',
  '$schema',
  'additionalProperties',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Zod writes the safe-integer limits on every `z.int()` for each bound the schema leaves
 * open (`z.int().min(1)` still writes `maximum: MAX_SAFE_INTEGER`); a contract writes only
 * the bounds it sets. On an integer, a bound equal to its safe limit is left out, each one
 * on its own.
 */
const SAFE_LIMITS: Readonly<Record<string, number>> = {
  minimum: Number.MIN_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
}

const isSafeLimit = (schema: Record<string, unknown>, keyword: string): boolean =>
  schema['type'] === 'integer' &&
  Object.hasOwn(SAFE_LIMITS, keyword) &&
  schema[keyword] === SAFE_LIMITS[keyword]

/**
 * A JSON Schema without the keywords above. Only the values of `properties` are
 * schemas themselves: its keys are parameter names (a parameter may be called
 * `title`) and are never filtered; every other keyword's value is compared as it is.
 */
export function bare(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema
  }

  return Object.fromEntries(
    Object.entries(schema)
      .filter(([keyword]) => !META_KEYWORDS.has(keyword))
      .filter(([keyword]) => !isSafeLimit(schema, keyword))
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
export const routeSearch = (search: RouteDef['search']): unknown =>
  search ? bare(z.toJSONSchema(search, { target: 'draft-2020-12', io: 'input' })) : undefined

/** The roles a route serves, as a set: each once, in one order. */
const roleSet = (roles: readonly string[]): readonly string[] => [...new Set(roles)].sort()

/** What a route and a binding are compared by. */
export interface Reading {
  readonly guard: Binding['guard']
  readonly roles: readonly string[]
  readonly history: Binding['history']
  readonly retain: readonly string[] | undefined
  readonly search: unknown
}

/** A route of the app, read as a binding reads. */
export const routeReading = (route: RouteDef): Reading => ({
  guard: route.guard,
  roles: roleSet(route.roles),
  history: route.history ?? 'push',
  retain: route.retain,
  search: routeSearch(route.search),
})

/** A binding of the contract, reduced to what the router enforces. */
export const bindingReading = (binding: Binding): Reading => ({
  guard: binding.guard,
  roles: roleSet(binding.roles),
  history: binding.history,
  retain: binding.retain,
  search: bare(binding.search),
})

/** Whether a route reads as a binding. */
const readsAs = (route: RouteDef, binding: Binding): boolean =>
  sameValue(routeReading(route), bindingReading(binding))

/** A binding with the screen that declares it. */
export interface ScreenBinding {
  readonly screen: string
  readonly binding: Binding
}

/** The bindings of screens, each with its screen. */
export const bindingsOf = (
  screens: readonly { readonly id: string; readonly bindings: readonly Binding[] }[],
): ScreenBinding[] =>
  screens.flatMap((screen) => screen.bindings.map((binding) => ({ screen: screen.id, binding })))

/**
 * The bindings of the screens at the branch's base (none outside the hook's ahead mode, or
 * where the base has no contract), or why the contract there does not load.
 */
export type AtBase = { readonly bindings: readonly ScreenBinding[] } | { readonly problem: string }

/** The bindings at the branch's base, read from the repository at `root` once per spec. */
export function bindingsAtBase(root: string): AtBase {
  const base = process.env['CONTRACT_AHEAD_BASE']

  if (!AHEAD || base === undefined || base === '') {
    return { bindings: [] }
  }

  let contract: ReturnType<typeof contractAt>

  try {
    contract = contractAt(base, root)
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }

  return { bindings: 'missing' in contract ? [] : bindingsOf(contract.screens.screens) }
}

/**
 * The binding a route of the app is held to on a branch: the one the contract says now, or the
 * same binding (the same screen, the same path) as the contract had it at the base, when the
 * route reads as that one and not as the one now, as the app has not started on what the branch
 * changed. A route that reads as neither is held to the binding now, which it fails.
 */
export function heldTo(
  route: RouteDef,
  now: ScreenBinding,
  base: readonly ScreenBinding[],
): ScreenBinding {
  const was = base.find(
    ({ screen, binding }) => screen === now.screen && binding.path === now.binding.path,
  )

  return was !== undefined && !readsAs(route, now.binding) && readsAs(route, was.binding)
    ? was
    : now
}

/**
 * The bindings the app's routes are held to. On `main` and in `bun run check`, every binding
 * as the contract says it now. On a branch, only the bindings a route of the app has, each as
 * `heldTo` says, so a binding may wait for its route.
 */
export function heldBindings(
  now: readonly ScreenBinding[],
  routes: readonly RouteDef[],
  base: readonly ScreenBinding[],
): readonly ScreenBinding[] {
  if (!AHEAD) {
    return now
  }

  const byPath = new Map(routes.map((route) => [route.path, route]))

  return now.flatMap((binding) => {
    const route = byPath.get(binding.binding.path)

    return route === undefined ? [] : [heldTo(route, binding, base)]
  })
}

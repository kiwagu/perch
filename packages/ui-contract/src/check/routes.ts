/**
 * Rule 4: the binding paths are routes of the router (TanStack syntax), parsed here
 * without the router: static segments, `$param`, `{-$param}` (optional) and `$` (splat,
 * last). Each path parameter is a property of the binding's `params` and each property
 * a path parameter; a path is bound by one screen.
 */

import type { Problem } from '../files'

import { type Contract, locate } from './contract'

export interface RouteSegment {
  kind: 'static' | 'param' | 'optional' | 'splat'
  name: string
}

/** The router's name for the value of a splat. */
const SPLAT = '_splat'

const STATIC = /^[a-z0-9][a-z0-9-]*$/
const PARAM = /^\$([a-zA-Z_][a-zA-Z0-9_]*)$/
const OPTIONAL = /^\{-\$([a-zA-Z_][a-zA-Z0-9_]*)\}$/

function segmentOf(text: string): RouteSegment | string {
  if (text === '') {
    return 'an empty segment'
  }

  if (text === '$') {
    return { kind: 'splat', name: SPLAT }
  }

  const param = PARAM.exec(text)?.[1]
  const optional = OPTIONAL.exec(text)?.[1]

  if (param !== undefined) {
    return { kind: 'param', name: param }
  }

  if (optional !== undefined) {
    return { kind: 'optional', name: optional }
  }

  return STATIC.test(text)
    ? { kind: 'static', name: text }
    : `"${text}" is not a segment of the router (static, $param, {-$param} or $)`
}

export function parseRoutePath(path: string): { segments: RouteSegment[]; problems: string[] } {
  if (!path.startsWith('/')) {
    return { segments: [], problems: ['a route path starts with "/"'] }
  }

  const segments: RouteSegment[] = []
  const problems: string[] = []
  const names = new Set<string>()

  for (const text of path === '/' ? [] : path.slice(1).split('/')) {
    const segment = segmentOf(text)

    if (typeof segment === 'string') {
      problems.push(segment)
    } else if (segments.at(-1)?.kind === 'splat') {
      problems.push('the splat "$" is the last segment')
    } else if (segment.kind !== 'static' && names.has(segment.name)) {
      problems.push(`parameter "${segment.name}" appears twice`)
    } else {
      if (segment.kind !== 'static') {
        names.add(segment.name)
      }

      segments.push(segment)
    }
  }

  return { segments, problems: [...new Set(problems)] }
}

/** The named parameters of a path: `$param` and `{-$param}`, not the splat. */
const parametersOf = (segments: readonly RouteSegment[]): string[] =>
  segments.filter(({ kind }) => kind === 'param' || kind === 'optional').map(({ name }) => name)

export function routesProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
  const owners = new Map<string, string>()

  return screens.screens.flatMap((screen, index) =>
    screen.bindings.flatMap((binding, number) => {
      const at = ['screens', index, 'bindings', number]
      const { segments, problems } = parseRoutePath(binding.path)
      const parameters = parametersOf(segments)
      const properties = Object.keys(binding.params?.properties ?? {})
      const owner = owners.get(binding.path)

      if (owner === undefined) {
        owners.set(binding.path, screen.id)
      }

      return [
        ...problems.map((problem) => inScreens([...at, 'path'], problem)),
        ...(owner === undefined
          ? []
          : [inScreens([...at, 'path'], `"${binding.path}" is also bound on screen "${owner}"`)]),
        ...parameters
          .filter((name) => !properties.includes(name))
          .map((name) =>
            inScreens(
              [...at, 'params'],
              `the path parameter "${name}" is not a property of params`,
            ),
          ),
        ...properties
          .filter((name) => !parameters.includes(name))
          .map((name) =>
            inScreens(
              [...at, 'params', 'properties', name],
              `"${name}" is not a parameter of the path "${binding.path}"`,
            ),
          ),
      ]
    }),
  )
}

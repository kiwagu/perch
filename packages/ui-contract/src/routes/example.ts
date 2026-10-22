/**
 * The example link of a binding: a deep link to its route with fake data, written the way
 * TanStack Router writes a link.
 *
 * The path is the binding's path segment by segment: a static segment as written; a `$param`
 * by `parameterSample` (its parameter's first example, else its default, else its first
 * `enum` value, else a value built within its bounds and pattern, the first of them the
 * parameter's schema accepts), the link refused when there is none, as the contract check
 * says the parameter needs an example; a `{-$param}` by its first example, its segment left
 * out when it has none; a splat `$` left out with its segment, as no parameter can be named
 * `_splat` to carry an example. Each value is written with `encodeURIComponent` (the router
 * leaves `[`, `]`, `|` and `^` bare in a path, so the web app's spec catches an example that
 * holds one).
 *
 * The search takes every key of the binding's `search` in its declared order, at its
 * `default`, else its first `enum` value, else its first example, and leaves out a key with
 * none. A default shows on purpose: the app's own links leave out a value equal to its
 * default, which reaches the same state. The search is written as the router's default
 * `stringifySearch` writes it: a string bare, unless it parses as JSON, then JSON-encoded
 * (`"123"`, so `%22123%22`), a number or a boolean as JSON, then the whole through
 * `URLSearchParams` (form encoding: a space as `+`, `!'()~` escaped).
 */

import { own, parameterSample, parseRoutePath, type RouteSegment } from '../check'
import type { Binding } from '../files'

type Value = string | number | boolean

type Parameter = NonNullable<Binding['params']>['properties'][string]

/** A binding's example: the values it is built with and the link they make. */
export interface RouteExample {
  /** Per path parameter that takes a value, the text of its segment before encoding. */
  readonly params: Readonly<Record<string, string>>
  /** Per search key that takes a value, in the order the schema declares the keys. */
  readonly search: Readonly<Record<string, Value>>
  /** The path with its parameters, then the search: `/sample/thg_01hzx9k2?view=read`. */
  readonly link: string
}

/** The value of a `$param` (`parameterSample`), or the refusal of a link that has none. */
function requiredValue(binding: Binding, parameter: Parameter | undefined, name: string): Value {
  const value = parameter === undefined ? undefined : parameterSample(parameter)

  if (value === undefined) {
    throw new Error(
      `${binding.path}: the path parameter "${name}" needs an example (no value of its schema can be built)`,
    )
  }

  return value
}

/** A segment of the path as the link writes it, and the parameter it fills, if any. */
interface Filled {
  readonly text?: string
  readonly param?: readonly [string, string]
}

function filled(binding: Binding, { kind, name }: RouteSegment): Filled {
  if (kind === 'static') {
    return { text: name }
  }

  if (kind === 'splat') {
    return {}
  }

  const parameter = own(binding.params?.properties ?? {}, name)
  const value =
    kind === 'optional' ? parameter?.examples?.[0] : requiredValue(binding, parameter, name)

  return value === undefined
    ? {}
    : { text: encodeURIComponent(String(value)), param: [name, String(value)] }
}

/** The value of a search key: its default, its first enum value or its first example. */
const searchValue = (parameter: Parameter): Value | undefined =>
  parameter.default ?? parameter.enum?.[0] ?? parameter.examples?.[0]

const parsesAsJson = (text: string): boolean => {
  try {
    JSON.parse(text)

    return true
  } catch {
    return false
  }
}

/** A search value as the router writes it, before the form encoding. */
const searchText = (value: Value): string =>
  typeof value === 'string' && !parsesAsJson(value) ? value : JSON.stringify(value)

export function exampleOf(binding: Binding): RouteExample {
  const segments = parseRoutePath(binding.path).segments.map((segment) => filled(binding, segment))
  const path = `/${segments.flatMap(({ text }) => (text === undefined ? [] : [text])).join('/')}`
  const search = Object.fromEntries(
    Object.entries(binding.search?.properties ?? {}).flatMap(([name, parameter]) => {
      const value = searchValue(parameter)

      return value === undefined ? [] : [[name, value] as const]
    }),
  )
  const query = new URLSearchParams(
    Object.entries(search).map(([name, value]): [string, string] => [name, searchText(value)]),
  ).toString()

  return {
    params: Object.fromEntries(
      segments.flatMap(({ param }) => (param === undefined ? [] : [param])),
    ),
    search,
    link: query === '' ? path : `${path}?${query}`,
  }
}

/**
 * The search parameter of a mail's link, derived from version 4: a platform action's `mail` links
 * to a screen and names the search parameter that carries the token (`link: { screen, search }`),
 * so every route of that screen has that parameter, built from the platform value of the same
 * name: its type, bounds, enum, description and examples. It is the screen's key, `x-perch.key`
 * (the rule `address-key`), with the first of the `codes` of the parameter that the first action
 * the screen runs with it takes it into, the action of its initial state before any other
 * (`search-takers.ts`): a token missing or broken is that failure; a parameter without `codes`,
 * or an action of the model, gives no key. Two mails that link to one screen with one name give it
 * once. No control of the page sets it, so the check wants none for its enum values
 * (`mailSearchesOf`). From version 4 a screen file never writes the parameter, and a mail whose
 * `search` names no value of the platform, or one a route cannot take (no type, or a format), is a
 * problem on its link. Before version 4 nothing is derived and a file writes the parameter as
 * before.
 */

import { PLATFORM_FILE } from '../paths'
import { jsonPath, type Problem } from '../problems'
import type { Binding, Platform, Screen } from '../screens'

import type { LoadedScreen } from './link-roles'
import { searchTakersOf } from './search-takers'

/** The version from which the search parameter of a mail's link is derived, and a file never writes it. */
const MAIL_LINK_EDITION = 4

const PLATFORM = 'platform.'

type Search = NonNullable<Binding['search']>
type Parameter = Search['properties'][string]
type PlatformValue = NonNullable<Platform['values']>[string]

/** What of the platform the derivation reads: its values and the actions, with their mails. */
type PlatformSource = Pick<Platform, 'actions' | 'values'>

/** A mail link some action sends to a screen: the parameter it takes, and the action that says so. */
interface Link {
  readonly action: string
  readonly parameter: Parameter
}

const ownOf = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/** The parameter a value gives a route, or why it gives none: it has no type, or names a format. */
function parameterOf(search: string, value: PlatformValue | undefined): Parameter | string {
  if (value === undefined) {
    return `"${search}" is no value of the platform, so the mail's link has no parameter to carry its token in`
  }

  const { type, enum: members, minLength, maxLength, pattern, minimum, maximum } = value
  const examples = (value.examples ?? []).filter(isPrimitive)

  if (type === undefined || value.format !== undefined) {
    return `"${search}" cannot be the search parameter of a route: it ${type === undefined ? 'has no type' : 'names a format, which a route never takes'}`
  }

  return {
    type,
    ...(members === undefined ? {} : { enum: [...members] }),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(pattern === undefined ? {} : { pattern }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    description: value.description,
    ...(examples.length === 0 ? {} : { examples }),
  }
}

/**
 * The search parameters of the screen `screenId` that the loader derives from the mails linking
 * to it: none before version 4, when a file writes them. No control of the page sets one, a link
 * carries it, so what the check wants of the controls of a route's parameters does not reach it.
 */
export function mailSearchesOf(
  platform: PlatformSource,
  screenId: string,
  edition: number,
): ReadonlySet<string> {
  return new Set(
    edition < MAIL_LINK_EDITION
      ? []
      : Object.values(platform.actions).flatMap(({ mail }) =>
          mail?.link.screen === screenId ? [mail.link.search] : [],
        ),
  )
}

/** The first of the codes of the parameter that the first action `screen` runs with `name` takes it into. */
function keyOf(screen: Screen, name: string, actions: Platform['actions']): string | undefined {
  const [taker] = searchTakersOf(screen, name)

  return taker?.action.startsWith(PLATFORM) === true
    ? ownOf(ownOf(actions, taker.action.slice(PLATFORM.length))?.params, taker.param)?.codes?.[0]
    : undefined
}

/** The links the mails of the platform make, by screen then by search parameter; the problems of those that make none. */
function linksOf({ actions, values }: PlatformSource): {
  links: Map<string, Map<string, Link>>
  problems: Problem[]
} {
  const links = new Map<string, Map<string, Link>>()
  const problems: Problem[] = []

  for (const [action, { mail }] of Object.entries(actions)) {
    if (mail === undefined) {
      continue
    }

    const { screen, search } = mail.link
    const parameter = parameterOf(search, ownOf(values, search))

    if (typeof parameter === 'string') {
      problems.push({
        file: PLATFORM_FILE,
        message: `${jsonPath(['actions', action, 'mail', 'link', 'search'])}: ${parameter}`,
      })
    } else {
      const named = links.get(screen) ?? new Map<string, Link>()

      if (!named.has(search)) {
        named.set(search, { action, parameter })
      }

      links.set(screen, named)
    }
  }

  return { links, problems }
}

/** `binding` with `parameter` among the search parameters of its route, which a route without a search gets. */
function withParameter(binding: Binding, name: string, parameter: Parameter): Binding {
  const search: Search = binding.search ?? {
    type: 'object',
    properties: {},
    additionalProperties: false,
  }

  return {
    ...binding,
    search: {
      ...search,
      properties: { ...search.properties, [name]: parameter },
    },
  }
}

/**
 * The screens each with the search parameter of the mail links to it on every one of its routes,
 * in their order, and the problems of a parameter a file writes that a mail derives, each filed
 * under the file of its screen, with those of a mail that names no parameter a route can take.
 */
export function withDerivedMailLinks(
  loaded: readonly LoadedScreen[],
  platform: PlatformSource,
  edition: number,
): { loaded: readonly LoadedScreen[]; problems: Problem[] } {
  if (edition < MAIL_LINK_EDITION) {
    return { loaded, problems: [] }
  }

  const { links, problems } = linksOf(platform)

  const derived = loaded.map(({ file, screen }) => {
    const derives = [...(links.get(screen.id) ?? [])].map(([name, { action, parameter }]) => {
      const key = keyOf(screen, name, platform.actions)

      return {
        name,
        action,
        parameter: {
          ...parameter,
          ...(key === undefined ? {} : { 'x-perch': { key } }),
        },
      }
    })

    if (screen.bindings.length === 0 || derives.length === 0) {
      return { file, screen }
    }

    const bindings = screen.bindings.map((binding, index) => {
      for (const { name, action } of derives) {
        if (Object.hasOwn(binding.search?.properties ?? {}, name)) {
          problems.push({
            file,
            message: `${jsonPath(['bindings', index, 'search', 'properties', name])}: derived from the mail link of the platform action "${action}"; leave it out`,
          })
        }
      }

      return derives.reduce(
        (current, { name, parameter }) => withParameter(current, name, parameter),
        binding,
      )
    })

    return { file, screen: { ...screen, bindings } }
  })

  return { loaded: derived, problems }
}

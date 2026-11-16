/**
 * The search parameter of a mail's link, dropped from the screen the mail links to, as the loader
 * derives it from version 4: each platform action's `mail.link: { screen, search }` gives every
 * route of that screen the parameter `search`, from the platform value of that name. A route's
 * written property of that name goes when it holds what the value does (`type`, `enum`, bounds,
 * `pattern`) and writes nothing the derived one lacks, and a `search` left as the bare wrapper the
 * loader creates goes with it. A property that holds something else would change the screen's
 * constraint, and one that writes a `default` or the controls of its page would lose what the
 * route does with a missing value or which control sets it, so it stays and is named; so is a mail
 * whose `search` names no platform value a route can take. A description, examples and the key a
 * property wrote are the platform value's and the loader's from then on.
 */

import type { Document } from 'yaml'

import { entriesOf, isRecord, recordOf, sameValue } from '../../../records'
import { PLATFORM_FILE } from '../../paths'

import { fileOf, type Plain, plainOf, type ScreenDocuments } from './screens'

/** What a property and the value it is derived from must say alike for the derived one to replace it. */
const CONSTRAINTS = ['type', 'enum', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum']

/** What a written property says that the derived one says too: the constraints, the description and the examples. */
const CARRIED = new Set([...CONSTRAINTS, 'description', 'examples'])

/** What a `search` holds when the loader created it for the parameters alone. */
const WRAPPER = new Set(['type', 'properties', 'additionalProperties'])

/** A parameter a mail's link carries: the platform action that says so, and the value it is made from. */
interface Parameter {
  readonly action: string
  readonly value: Plain
}

/** The parameters the mails of the platform make, by the screen then the name; the lines of those that make none. */
function parametersOf(platform: Document): {
  byScreen: Map<string, Map<string, Parameter>>
  manual: string[]
} {
  const { actions, values } = plainOf(platform)
  const byScreen = new Map<string, Map<string, Parameter>>()
  const manual: string[] = []

  for (const [action, def] of entriesOf(actions)) {
    const { screen, search } = recordOf(recordOf(recordOf(def)['mail'])['link'])

    if (typeof screen !== 'string' || typeof search !== 'string') {
      continue
    }

    const value = recordOf(values)[search]

    if (!isRecord(value) || value['type'] === undefined || value['format'] !== undefined) {
      manual.push(
        `${PLATFORM_FILE}: actions.${action}.mail.link.search: "${search}" is no platform value a route can take (it needs a type and no format): fix it, and drop the property from the routes of ${screen} by hand`,
      )
    } else {
      byScreen.set(
        screen,
        (byScreen.get(screen) ?? new Map<string, Parameter>()).set(search, { action, value }),
      )
    }
  }

  return { byScreen, manual }
}

/** What a written property says that the derived one does not: a `default`, the controls of its page. */
const extrasOf = (property: Plain): string[] => [
  ...Object.keys(property).filter((key) => key !== 'x-perch' && !CARRIED.has(key)),
  ...Object.keys(recordOf(property['x-perch']))
    .filter((key) => key !== 'key')
    .map((key) => `x-perch.${key}`),
]

/** Whether `search` is what the loader creates for the parameters alone, once none is left. */
const isWrapperOf = (search: Plain, left: number): boolean =>
  left === 0 &&
  search['type'] === 'object' &&
  search['additionalProperties'] === false &&
  Object.keys(search).every((key) => WRAPPER.has(key))

/** Drops the parameters of one route that hold what the platform value does; the lines of those that do not. */
function dropFromRoute(
  document: Document,
  at: { file: string; index: number },
  search: Plain,
  parameters: ReadonlyMap<string, Parameter>,
): string[] {
  const written = recordOf(search['properties'])
  const dropped: string[] = []
  const manual: string[] = []

  for (const [name, { action, value }] of parameters) {
    const property = written[name]

    if (property === undefined) {
      continue
    }

    const differs = CONSTRAINTS.filter((key) => !sameValue(recordOf(property)[key], value[key]))
    const extras = extrasOf(recordOf(property))
    const where = `${at.file}: bindings[${at.index}].search.properties.${name}`

    if (differs.length === 0 && extras.length === 0) {
      dropped.push(name)
    }

    if (differs.length > 0) {
      manual.push(
        `${where}: it differs from the platform value "${name}" that the mail of ${action} derives it from, in ${differs.join(', ')}: make them agree and drop it by hand`,
      )
    }

    if (extras.length > 0) {
      manual.push(
        `${where}: it writes ${extras.join(', ')}, which the parameter the mail of ${action} derives from the platform value "${name}" does not carry${extras.includes('default') ? " (a screen's key has no default)" : ''}: decide by hand, then drop it`,
      )
    }
  }

  if (dropped.length > 0 && isWrapperOf(search, Object.keys(written).length - dropped.length)) {
    document.deleteIn(['bindings', at.index, 'search'])
  } else {
    for (const name of dropped) {
      document.deleteIn(['bindings', at.index, 'search', 'properties', name])
    }
  }

  return manual
}

/** The lines left to do by hand after the search parameters the mails derive are dropped. */
export function dropMailLinkSearch(platform: Document, screens: ScreenDocuments): string[] {
  const { byScreen, manual } = parametersOf(platform)

  for (const [path, document] of screens) {
    const screen = plainOf(document)
    const parameters = typeof screen['id'] === 'string' ? byScreen.get(screen['id']) : undefined
    const bindings: unknown = screen['bindings']

    if (parameters === undefined || !Array.isArray(bindings)) {
      continue
    }

    for (const [index, binding] of bindings.entries()) {
      manual.push(
        ...dropFromRoute(
          document,
          { file: fileOf(path), index },
          recordOf(recordOf(binding)['search']),
          parameters,
        ),
      )
    }
  }

  return manual
}

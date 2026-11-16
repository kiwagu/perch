/**
 * The key of an address (the rule `address-key`): a search parameter of a route that writes
 * `x-perch.key: <code>` is the screen's key, and `<code>` the failure its value missing or broken
 * is. The code is one of an action the screen runs with `{ search: <name> }`, an invoke's `input`
 * (a region written `by` its button included, as the loader expands it) or a list's `source`
 * `params`; each such action whose code it is takes the parameter into one that refers to a value
 * (`value` on a platform action, the field it sets on an action of the model), which the address's
 * value is held to; a route has one key; and a key writes no `default`, which would fill the value
 * the key says is missing. The loader derives the key of a mail's link (`files/derive/mail-links.ts`),
 * which this reads as it reads a written one, and an older contract writes none.
 */

import {
  type Binding,
  failuresOf,
  type Problem,
  parameterValueOf,
  type Screen,
  type SearchTaker,
  searchTakersOf,
} from '../files'

import { type Contract, type InScreens, locate, own, PLATFORM_ACTION } from './contract'
import { editionOf } from './editions'

/** A search parameter of a route that is the screen's key, with its code. */
interface Key {
  readonly name: string
  readonly code: string
  readonly property: NonNullable<Binding['search']>['properties'][string]
}

/**
 * Whether the parameter that takes the key refers to a value: a platform parameter writes its
 * `value`, a parameter of an action of the model takes that of the field it sets (a new id, `$id`,
 * sets none).
 */
function refersToValue(contract: Contract, { action, param }: SearchTaker): boolean {
  const { platform } = contract.screens

  if (action.startsWith(PLATFORM_ACTION)) {
    const declared = own(platform.actions, action.slice(PLATFORM_ACTION.length))

    return declared !== undefined && own(declared.params, param)?.value !== undefined
  }

  return Object.keys(parameterValueOf(action, param, platform, contract.model)).length > 0
}

/** The keys of a route's search, in the order it writes them. */
const keysOf = (binding: Binding): Key[] =>
  Object.entries(binding.search?.properties ?? {}).flatMap(([name, property]) => {
    const code = property['x-perch']?.key

    return code === undefined ? [] : [{ name, code, property }]
  })

/** What a key's code needs of the actions that take its parameter: one of them fails with it. */
function codeMessages(contract: Contract, screen: Screen, { name, code }: Key): string[] {
  const takers = searchTakersOf(screen, name)

  if (takers.length === 0) {
    return [
      `no action the screen runs takes "${name}" as { search: ${name} } (an invoke's input or a source's params), so it is the key of nothing`,
    ]
  }

  const failureOf = failuresOf(
    contract.model,
    contract.screens.platform.actions,
    editionOf(contract),
  )
  const carriers = takers.filter(({ action }) => {
    const failure = failureOf(action)

    return typeof failure === 'object' && failure.codes.includes(code)
  })

  if (carriers.length === 0) {
    const actions = [...new Set(takers.map(({ action }) => action))].join(', ')

    return [`"${code}" is no code of the actions that take "${name}": ${actions}`]
  }

  return carriers
    .filter((carrier) => !refersToValue(contract, carrier))
    .map(
      ({ action, param }) =>
        `"${name}" goes to the parameter "${param}" of ${action}, which refers to no value: the value the key must keep is the value its action takes`,
    )
}

/** The problems of the keys of one route, each at its own key. */
function routeKeyProblems(
  contract: Contract,
  inScreens: InScreens,
  screen: Screen,
  binding: Binding,
  at: readonly PropertyKey[],
): Problem[] {
  const keys = keysOf(binding)
  const [first] = keys

  return keys.flatMap((key, index) => {
    const here = [...at, 'search', 'properties', key.name]
    const atKey = [...here, 'x-perch', 'key']

    return [
      ...codeMessages(contract, screen, key).map((message) => inScreens(atKey, message)),
      ...(index > 0 && first !== undefined
        ? [inScreens(atKey, `a route has one key, and "${first.name}" is its key already`)]
        : []),
      ...(key.property.default === undefined
        ? []
        : [
            inScreens(
              [...here, 'default'],
              `a key has no default: the address that leaves "${key.name}" out is the failure "${key.code}"`,
            ),
          ]),
    ]
  })
}

export function keyProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)

  return contract.screens.screens.flatMap((screen, index) =>
    screen.bindings.flatMap((binding, number) =>
      routeKeyProblems(contract, inScreens, screen, binding, [
        'screens',
        index,
        'bindings',
        number,
      ]),
    ),
  )
}

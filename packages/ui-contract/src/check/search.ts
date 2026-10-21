/**
 * Rule 5: the route parameters a page sets have their controls. Every enum value of a
 * `params` or `search` property has a control under `x-perch.values` (and no other value
 * does), every control is a declared anchor, and `retain` names search parameters. That
 * the schemas are flat objects of primitives is the Zod schema's job (`flatJsonSchema`).
 */

import type { Binding, Problem } from '../files'

import { type Contract, inScreens, knownAnchors } from './contract'

type FlatSchema = NonNullable<Binding['search']>

function schemaProblems(
  known: (anchor: string) => boolean,
  schema: FlatSchema | undefined,
  at: readonly PropertyKey[],
): Problem[] {
  return Object.entries(schema?.properties ?? {}).flatMap(([name, property]) => {
    const here = [...at, 'properties', name]
    const perch = property['x-perch']
    const values = perch?.values ?? {}
    const enumValues = (property.enum ?? []).map(String)
    const control = (anchor: string | undefined, path: readonly PropertyKey[]): Problem[] =>
      anchor === undefined || known(anchor)
        ? []
        : [inScreens(path, `"${anchor}" is not a declared anchor`)]

    return [
      ...control(perch?.control, [...here, 'x-perch', 'control']),
      ...enumValues
        .filter((value) => !(value in values))
        .map((value) =>
          inScreens(here, `the enum value "${value}" has no control under x-perch.values`),
        ),
      ...Object.entries(values).flatMap(([value, choice]) => [
        ...(enumValues.includes(value)
          ? []
          : [inScreens([...here, 'x-perch', 'values', value], `"${value}" is not an enum value`)]),
        ...control(choice.control, [...here, 'x-perch', 'values', value, 'control']),
      ]),
    ]
  })
}

export function searchProblems(contract: Contract): Problem[] {
  const known = knownAnchors(contract)

  return contract.screens.screens.flatMap((screen, index) =>
    screen.bindings.flatMap((binding, number) => {
      const at = ['screens', index, 'bindings', number]
      const searchNames = Object.keys(binding.search?.properties ?? {})

      return [
        ...schemaProblems(known, binding.params, [...at, 'params']),
        ...schemaProblems(known, binding.search, [...at, 'search']),
        ...(binding.retain ?? []).flatMap((name, position) =>
          searchNames.includes(name)
            ? []
            : [inScreens([...at, 'retain', position], `"${name}" is not a search parameter`)],
        ),
      ]
    }),
  )
}

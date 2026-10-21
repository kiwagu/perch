/**
 * Rule 5: the route parameters a page sets have their controls. Every enum value of a
 * `params` or `search` property has a control under `x-perch.values` (and no other value
 * does), every control is a declared anchor, a `controlValue` is a choice value of its
 * control in the vocabulary, and `retain` names search parameters. That the schemas are
 * flat objects of primitives is the Zod schema's job (`flatJsonSchema`); that each is a
 * valid JSON Schema (a `pattern` that compiles, `required` without repeats) is Ajv's.
 */

import {
  type Binding,
  jsonSchemaProblems,
  type Problem,
  SCREENS_FILE,
  type Vocabulary,
} from '../files'

import { type Contract, has, inScreens, isValueOf, knownAnchors, own } from './contract'

type FlatSchema = NonNullable<Binding['search']>

/** What the anchor of a control lacks to choose `value`: its own choice values have no such row. */
function controlValueProblems(
  vocabulary: Vocabulary,
  control: string,
  value: string | undefined,
  at: readonly PropertyKey[],
): Problem[] {
  if (value === undefined) {
    return []
  }

  const rows = own(vocabulary.choiceValues, control)

  if (rows === undefined) {
    return [inScreens(at, `"${value}": "${control}" has no choice values in the vocabulary`)]
  }

  if (isValueOf(rows, value)) {
    return []
  }

  const owner = Object.entries(vocabulary.choiceValues).find(([, other]) =>
    isValueOf(other, value),
  )?.[0]
  const borrowed = owner === undefined ? '' : `; it is one of "${owner}"`

  return [inScreens(at, `"${value}" is not a choice value of "${control}"${borrowed}`)]
}

/** The problems of `schema` as a JSON Schema 2020-12, at its binding, naming its screen. */
const validityProblems = (
  screen: string,
  schema: FlatSchema | undefined,
  at: readonly PropertyKey[],
): Problem[] =>
  schema === undefined
    ? []
    : jsonSchemaProblems(SCREENS_FILE, schema).map(({ message }) =>
        inScreens(at, `not a valid JSON Schema (screen "${screen}"): ${message}`),
      )

function schemaProblems(
  { vocabulary, known }: { vocabulary: Vocabulary; known: (anchor: string) => boolean },
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
        .filter((value) => !has(values, value))
        .map((value) =>
          inScreens(here, `the enum value "${value}" has no control under x-perch.values`),
        ),
      ...Object.entries(values).flatMap(([value, choice]) => [
        ...(enumValues.includes(value)
          ? []
          : [inScreens([...here, 'x-perch', 'values', value], `"${value}" is not an enum value`)]),
        ...control(choice.control, [...here, 'x-perch', 'values', value, 'control']),
        ...controlValueProblems(vocabulary, choice.control, choice.controlValue, [
          ...here,
          'x-perch',
          'values',
          value,
          'controlValue',
        ]),
      ]),
    ]
  })
}

export function searchProblems(contract: Contract): Problem[] {
  const lookups = { vocabulary: contract.vocabulary, known: knownAnchors(contract) }

  return contract.screens.screens.flatMap((screen, index) =>
    screen.bindings.flatMap((binding, number) => {
      const at = ['screens', index, 'bindings', number]
      const searchNames = Object.keys(binding.search?.properties ?? {})

      return [
        ...validityProblems(screen.id, binding.params, [...at, 'params']),
        ...schemaProblems(lookups, binding.params, [...at, 'params']),
        ...validityProblems(screen.id, binding.search, [...at, 'search']),
        ...schemaProblems(lookups, binding.search, [...at, 'search']),
        ...(binding.retain ?? []).flatMap((name, position) =>
          searchNames.includes(name)
            ? []
            : [inScreens([...at, 'retain', position], `"${name}" is not a search parameter`)],
        ),
      ]
    }),
  )
}

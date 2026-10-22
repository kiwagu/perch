/**
 * Rule 5: the route parameters a page sets have their controls. Every enum value of a
 * `params` or `search` property has a control under `x-perch.values` (and no other value
 * does), every control is a declared anchor, a `controlValue` is a choice value of its
 * control in the vocabulary, and `retain` names search parameters. That the schemas are
 * flat objects of primitives is the Zod schema's job (`flatJsonSchema`); that each is a
 * valid JSON Schema (a `pattern` that compiles, `required` without repeats) is Ajv's, and
 * so, once it is, is that every one of a property's `examples` matches that property and
 * that a path parameter a link must fill (a `$param`) has a value its schema accepts
 * (`parameterSample` for a path segment): one without needs an example. A path segment is
 * never empty, so neither is an example of a path parameter.
 */

import {
  type Binding,
  createValidator,
  jsonSchemaProblems,
  type Problem,
  SCREENS_DIR,
  type Vocabulary,
} from '../files'

import {
  type Contract,
  has,
  type InScreens,
  isValueOf,
  knownAnchors,
  locate,
  own,
} from './contract'
import { parameterSample } from './parameter-sample'
import { parseRoutePath } from './routes'

type FlatSchema = NonNullable<Binding['search']>

/** The contract with the lookups every route schema needs, built once. */
interface Lookups {
  readonly vocabulary: Vocabulary
  readonly known: (anchor: string) => boolean
  readonly inScreens: InScreens
}

/** What the anchor of a control lacks to choose `value`: its own choice values have no such row. */
function controlValueProblems(
  { vocabulary, inScreens }: Lookups,
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
  { inScreens }: Lookups,
  screen: string,
  schema: FlatSchema | undefined,
  at: readonly PropertyKey[],
): Problem[] =>
  schema === undefined
    ? []
    : jsonSchemaProblems(SCREENS_DIR, schema).map(({ message }) =>
        inScreens(at, `not a valid JSON Schema (screen "${screen}"): ${message}`),
      )

/** Why an empty example cannot fill a path segment. */
const EMPTY_SEGMENT = 'a path segment cannot be empty'

/**
 * The examples of each property that the property's own schema refuses, with Ajv's reasons,
 * and in `params` an empty one, which no path segment can carry.
 */
function exampleProblems(
  { inScreens }: Lookups,
  schema: FlatSchema | undefined,
  inPath: boolean,
  at: readonly PropertyKey[],
): Problem[] {
  return Object.entries(schema?.properties ?? {}).flatMap(([name, property]) => {
    if (property.examples === undefined) {
      return []
    }

    const validate = createValidator().compile(property)

    return property.examples.flatMap((example, index) => {
      const reasons = [
        ...(validate(example)
          ? []
          : (validate.errors ?? []).map(({ message, keyword }) => message ?? keyword)),
        ...(inPath && example === '' ? [EMPTY_SEGMENT] : []),
      ]

      if (reasons.length === 0) {
        return []
      }

      return [
        inScreens(
          [...at, 'properties', name, 'examples', index],
          `${JSON.stringify(example)} does not match its parameter: ${reasons.join('; ')}`,
        ),
      ]
    })
  })
}

/**
 * The parameters of `filled` that no value of their schema can be built for as a path
 * segment: their schema permits only the empty string, or nothing that can be built.
 */
const unsampledProblems = (
  { inScreens }: Lookups,
  schema: FlatSchema | undefined,
  filled: readonly string[],
  at: readonly PropertyKey[],
): Problem[] =>
  Object.entries(schema?.properties ?? {})
    .filter(
      ([name, property]) =>
        filled.includes(name) && parameterSample(property, 'path') === undefined,
    )
    .map(([name, property]) =>
      inScreens(
        [...at, 'properties', name],
        `needs an example (${parameterSample(property, 'search') === '' ? EMPTY_SEGMENT : 'no value of its schema can be built'})`,
      ),
    )

/** The path parameters a link to `path` must fill: its `$param`s, not the optional ones. */
const requiredParameters = (path: string): string[] =>
  parseRoutePath(path)
    .segments.filter(({ kind }) => kind === 'param')
    .map(({ name }) => name)

/**
 * A route schema: valid as a JSON Schema, then its examples and, for the `params` of the
 * route path `path`, a value for each parameter a link must carry; and its controls.
 */
function routeSchemaProblems(
  lookups: Lookups,
  screen: string,
  schema: FlatSchema | undefined,
  path: string | undefined,
  at: readonly PropertyKey[],
): Problem[] {
  const validity = validityProblems(lookups, screen, schema, at)
  const filled = path === undefined ? [] : requiredParameters(path)

  return [
    ...(validity.length > 0
      ? validity
      : [
          ...exampleProblems(lookups, schema, path !== undefined, at),
          ...unsampledProblems(lookups, schema, filled, at),
        ]),
    ...schemaProblems(lookups, schema, at),
  ]
}

function schemaProblems(
  lookups: Lookups,
  schema: FlatSchema | undefined,
  at: readonly PropertyKey[],
): Problem[] {
  const { known, inScreens } = lookups

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
        ...controlValueProblems(lookups, choice.control, choice.controlValue, [
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
  const lookups: Lookups = {
    vocabulary: contract.vocabulary,
    known: knownAnchors(contract),
    inScreens: locate(contract.screens),
  }
  const { inScreens } = lookups

  return contract.screens.screens.flatMap((screen, index) =>
    screen.bindings.flatMap((binding, number) => {
      const at = ['screens', index, 'bindings', number]
      const searchNames = Object.keys(binding.search?.properties ?? {})

      return [
        ...routeSchemaProblems(lookups, screen.id, binding.params, binding.path, [...at, 'params']),
        ...routeSchemaProblems(lookups, screen.id, binding.search, undefined, [...at, 'search']),
        ...(binding.retain ?? []).flatMap((name, position) =>
          searchNames.includes(name)
            ? []
            : [inScreens([...at, 'retain', position], `"${name}" is not a search parameter`)],
        ),
      ]
    }),
  )
}

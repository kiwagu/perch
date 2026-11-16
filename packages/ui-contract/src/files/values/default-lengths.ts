/**
 * The default length, applied once where the platform and the model meet, before anything is
 * derived from either: from version 6 each value of `platform.values` and each field of the model,
 * in its entities and in its document alike, takes the platform's `defaults` (`withDefaultLength`),
 * so every reader takes the resolved value and none applies the default itself. A `null` limit is
 * left out at every version: before version 6 it says what no limit says. From version 6 a written
 * `maxLength` the default would give back is a problem where it is written, and so is a `null` on
 * a value that would take no default (no `defaults`, no string, or an `enum`).
 */

import { isRecord, recordOf } from '../../records'
import type { PlatformDefaults } from '../../schemas'
import type { Model, ModelEntity } from '../model'
import { MODEL_FILE, PLATFORM_FILE } from '../paths'
import { jsonPath, type Problem } from '../problems'
import type { PlatformFile, PlatformValue } from '../screens'

import { DEFAULTS_EDITION, givesBack, takesDefault, withDefaultLength } from './defaults'

export interface DefaultLengths {
  /** The values of the platform, each with its length resolved; none where it declares none. */
  readonly values?: Record<string, PlatformValue> | undefined
  /** The model with every field's length resolved, in its entities and its document. */
  readonly model?: Model | undefined
  readonly problems: Problem[]
}

const mapped = <T, U>(
  record: Readonly<Record<string, T>>,
  map: (entry: T, key: string) => U,
): Record<string, U> =>
  Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, map(entry, key)]))

const leaveOut = (number: number) =>
  `${number} is the default length (\`defaults.maxLength\`), which the value takes: leave it out`

/** The problems of the lengths the platform's values write. */
function valueProblems(
  values: NonNullable<PlatformFile['values']>,
  defaults: PlatformDefaults | undefined,
): Problem[] {
  return Object.entries(values).flatMap(([name, value]) => {
    const at = jsonPath(['values', name, 'maxLength'])

    if (givesBack(value, defaults, false)) {
      return [{ file: PLATFORM_FILE, message: `${at}: ${leaveOut(value.maxLength ?? 0)}` }]
    }

    if (value.maxLength !== null || (defaults !== undefined && takesDefault(value, false))) {
      return []
    }

    const why =
      defaults === undefined
        ? 'the platform declares none (`defaults.maxLength`)'
        : 'a value that is no string, or has an `enum`, takes none anyway'

    return [
      {
        file: PLATFORM_FILE,
        message: `${at}: null says the value takes no default length, but ${why}: leave it out`,
      },
    ]
  })
}

/** The problems of the lengths the fields of the model write that the default gives back. */
const fieldProblems = (model: Model, defaults: PlatformDefaults | undefined): Problem[] =>
  Object.values(model.entities).flatMap(({ name, fields }) =>
    Object.entries(fields).flatMap(([field, written]) =>
      givesBack(written, defaults, written.readonly)
        ? [
            {
              file: MODEL_FILE,
              message: `${jsonPath(['$defs', name, 'properties', field, 'maxLength'])}: ${leaveOut(written.maxLength ?? 0)}`,
            },
          ]
        : [],
    ),
  )

/** The model document with the length each field took written into its property. */
function documentWith(
  document: Model['document'],
  entities: Readonly<Record<string, ModelEntity>>,
): Model['document'] {
  const definitions = recordOf(document['$defs'])

  return {
    ...document,
    $defs: mapped(definitions, (definition, name) => {
      const { properties } = recordOf(definition)
      const fields = Object.hasOwn(entities, name) ? entities[name]?.fields : undefined

      return isRecord(definition) && isRecord(properties) && fields !== undefined
        ? {
            ...definition,
            properties: mapped(properties, (property, field) => {
              const maxLength = Object.hasOwn(fields, field) ? fields[field]?.maxLength : undefined

              return isRecord(property) &&
                property['maxLength'] === undefined &&
                maxLength !== undefined
                ? { ...property, maxLength }
                : property
            }),
          }
        : definition
    }),
  }
}

/** The model with the default length taken by every field that names none. */
function modelWith(model: Model, defaults: PlatformDefaults): Model {
  const entities = mapped(model.entities, (entity) => ({
    ...entity,
    fields: mapped(entity.fields, (field) => withDefaultLength(field, defaults, field.readonly)),
  }))

  return { document: documentWith(model.document, entities), entities }
}

/**
 * The values of `platform` and `model` with their lengths resolved, and the problems of the lengths
 * they write.
 */
export function withDefaultLengths(
  platform: PlatformFile | undefined,
  model: Model | undefined,
): DefaultLengths {
  const current = (platform?.version ?? 1) >= DEFAULTS_EDITION
  const defaults = current ? platform?.defaults : undefined
  const written = platform?.values

  return {
    ...(written === undefined
      ? {}
      : { values: mapped(written, (value) => withDefaultLength(value, defaults)) }),
    ...(model === undefined
      ? {}
      : { model: defaults === undefined ? model : modelWith(model, defaults) }),
    problems: current
      ? [
          ...(written === undefined ? [] : valueProblems(written, defaults)),
          ...(model === undefined ? [] : fieldProblems(model, defaults)),
        ]
      : [],
  }
}

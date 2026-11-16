/**
 * Version 5 to 6: from version 6 a value that names no limit takes the platform's default length
 * (`defaults.maxLength`), and a written limit the default gives back is refused. Where the platform
 * declares a default, each value loads with the limit it had: a value of `platform.values` and a
 * field of the model drop a `maxLength` equal to it on a value that would take it (`givesBack`),
 * and a value of `platform.values` that would take it and names no limit gets `maxLength: null`,
 * before its `pattern`, `description` or `examples`. A field of the model that names no limit
 * cannot say `null` (its JSON Schema allows none) and takes the default: the step names it, left
 * to the author. A limit of another number, one on a value the default never reaches (no string,
 * an `enum`, a read-only field), and every value of a contract that declares no default stay as
 * written: the step never drops a limit the engine does not give back, nor gives one a value did
 * not have. The model is JSON, edited as text: the member goes with its comma, every other byte
 * stays.
 */

import { isDeepStrictEqual } from 'node:util'

import { isMap, isScalar, type Range } from 'yaml'

import { entriesOf, isRecord, recordOf } from '../../records'
import type { PlatformDefaults } from '../../schemas'
import { MODEL_FILE } from '../paths'
import { jsonPath } from '../problems'
import { parseYamlDocument } from '../read-yaml-document'
import { givesBack, takesDefault } from '../values'

import type { Migration, MigrationFiles } from './migration'
import { plainOf } from './screens'

/** What of a value's keywords decides whether the default gives its limit back. */
const lengthedOf = (value: unknown) => {
  const { type, enum: values, maxLength } = recordOf(value)

  return { type, enum: values, maxLength: typeof maxLength === 'number' ? maxLength : undefined }
}

/** The default the platform declares, read as plain data; none when it declares none. */
function defaultsOf(platform: Readonly<Record<string, unknown>>): PlatformDefaults | undefined {
  const { maxLength } = recordOf(platform['defaults'])

  return typeof maxLength === 'number' ? { maxLength } : undefined
}

/** The start and the end of a node of the text, as the parser read it. */
const spanOf = (range: Range | null | undefined): readonly [number, number] => {
  if (range === null || range === undefined) {
    throw new Error('the model has a member the parser gave no place')
  }

  return [range[0], range[1]]
}

/** The JSON `text` holds with the member `key` of the object at `path` taken out. */
function parsedWithout(text: string, path: readonly string[], key: string): unknown {
  const document: unknown = JSON.parse(text)
  const object = path.reduce<unknown>((node, step) => recordOf(node)[step], document)

  if (isRecord(object)) {
    Reflect.deleteProperty(object, key)
  }

  return document
}

/**
 * `text` without the member `key` of the object at `path`: from its key to the next member's key,
 * or, for the last one, from the end of the member before it, so its comma goes with it. The text
 * is read back and must hold the same JSON less that member, else this throws.
 */
function withoutMember(text: string, path: readonly string[], key: string): string {
  const object = parseYamlDocument(text).getIn(path, true)
  const items = isMap(object) ? object.items : []
  const at = items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key)
  const pair = items[at]
  const next = items[at + 1]
  const previous = items[at - 1]

  if (pair === undefined || !isScalar(pair.key) || !isScalar(pair.value)) {
    throw new Error(`the model has no ${[...path, key].join('.')} to drop`)
  }

  const [start] = spanOf(pair.key.range)
  const [, end] = spanOf(pair.value.range)
  const [from, to] =
    next !== undefined && isScalar(next.key)
      ? [start, spanOf(next.key.range)[0]]
      : previous !== undefined && isScalar(previous.value) && previous.value.range
        ? [spanOf(previous.value.range)[1], end]
        : [start, end]

  const edited = `${text.slice(0, from)}${text.slice(to)}`

  if (!isDeepStrictEqual(JSON.parse(edited), parsedWithout(text, path, key))) {
    throw new Error(`the model cannot drop ${[...path, key].join('.')} from its text`)
  }

  return edited
}

/** The keys of a value a `maxLength` the step writes goes before, the first one it has. */
const AFTER_LENGTH = ['pattern', 'description', 'examples']

/** Whether a value names no limit and would take the default: from version 6 it would gain one. */
const gains = (value: unknown, readOnly: boolean): boolean =>
  takesDefault(lengthedOf(value), readOnly) && recordOf(value)['maxLength'] === undefined

/**
 * Drops from the platform's values each limit the default gives back, and writes `maxLength: null`
 * on each that names none and would take it.
 */
function keepValueLimits(files: MigrationFiles, defaults: PlatformDefaults) {
  for (const [name, value] of entriesOf(plainOf(files.platform)['values'])) {
    const node = files.platform.getIn(['values', name], true)

    if (givesBack(lengthedOf(value), defaults, false)) {
      files.platform.deleteIn(['values', name, 'maxLength'])
    } else if (gains(value, false) && isMap(node)) {
      const at = node.items.findIndex(
        (pair) => isScalar(pair.key) && AFTER_LENGTH.includes(String(pair.key.value)),
      )

      node.items.splice(
        at === -1 ? node.items.length : at,
        0,
        files.platform.createPair('maxLength', null),
      )
    }
  }
}

/** A line for each field of the model that names no limit and takes the default from version 6. */
const gainedFields = (model: string, defaults: PlatformDefaults): string[] =>
  entriesOf(recordOf(model.trim() === '' ? {} : JSON.parse(model))['$defs']).flatMap(
    ([entity, definition]) =>
      entriesOf(recordOf(definition)['properties']).flatMap(([field, property]) =>
        gains(property, recordOf(recordOf(property)['x-perch'])['readonly'] === true)
          ? [
              `${MODEL_FILE}: ${jsonPath(['$defs', entity, 'properties', field])}: names no limit, and from version 6 takes the default length, ${defaults.maxLength}: write its own \`maxLength\` where that is too short`,
            ]
          : [],
      ),
  )

/** The model's text without each field limit the default gives back. */
function withoutFieldLimits(model: string, defaults: PlatformDefaults): string {
  const document: unknown = model.trim() === '' ? {} : JSON.parse(model)
  const dropped = entriesOf(recordOf(document)['$defs']).flatMap(([entity, definition]) =>
    entriesOf(recordOf(definition)['properties']).flatMap(([field, property]) => {
      const readOnly = recordOf(recordOf(property)['x-perch'])['readonly'] === true

      return isRecord(property) && givesBack(lengthedOf(property), defaults, readOnly)
        ? [['$defs', entity, 'properties', field]]
        : []
    }),
  )

  return dropped.reduce((text, path) => withoutMember(text, path, 'maxLength'), model)
}

export const fiveToSix: Migration = {
  from: 5,
  note: 'a value that names no limit takes the default length: the files keep each value at the limit it had',
  run: (files) => {
    const defaults = defaultsOf(plainOf(files.platform))

    if (defaults === undefined) {
      return []
    }

    // Read before any limit is dropped: a field the step drops one from gains nothing.
    const gained = gainedFields(files.model, defaults)

    keepValueLimits(files, defaults)
    files.model = withoutFieldLimits(files.model, defaults)

    return gained
  },
}

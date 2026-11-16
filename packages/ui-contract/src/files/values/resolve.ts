/**
 * The value a ref names, and the value a parameter takes. A ref names a value of
 * `platform.values` by its name, or a field of the model as `<entity>.<field>`: the keywords of
 * its JSON Schema a value has (its type, enum, lengths, pattern, format and numeric bounds), a
 * format no value names left out, `readOnly` where the field is `x-perch.readonly`. A parameter of a platform action takes the value it refers to narrowed by
 * each keyword it writes beside it (`narrowed`: one that would widen it is left out, and refused
 * by the check), a paged action's `size` the action's sizes as its `enum`, and a parameter that
 * refers to nothing its own keywords, its type alone at least; a parameter of an action of the
 * model takes the value of the field it sets. What names nothing known gives no constraint: the
 * contract check says why.
 */

import { SIZE } from '../../anchors'
import { VALUE_FORMATS } from '../../schemas'
import type { Model, ModelField } from '../model'
import type { Platform } from '../screens'

import { keywordsOf, type ResolvedValue } from './keywords'
import { narrowed } from './narrow'

type ValueFormat = (typeof VALUE_FORMATS)[number]

const PLATFORM = 'platform.'

/** The entry `key` of `record`, unless only the prototype has it. */
const ownOf = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

const isValueFormat = (format: string | undefined): format is ValueFormat =>
  VALUE_FORMATS.some((known) => known === format)

const isMember = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number'

/** The value of a field of the model: its constraints, an enum of other members left out whole. */
function modelValueOf(field: ModelField): ResolvedValue {
  const { type, enum: values, minLength, maxLength, pattern, format, minimum, maximum } = field

  return keywordsOf({
    type,
    enum: values?.every(isMember) ? [...values] : undefined,
    minLength,
    maxLength,
    pattern,
    format: isValueFormat(format) ? format : undefined,
    minimum,
    maximum,
    readOnly: field.readonly ? true : undefined,
  })
}

/** The field of the model `<entity>.<field>` names; undefined when it names none. */
function modelFieldOf(path: string, model: Model | undefined): ModelField | undefined {
  const [entity = '', field = ''] = path.split('.')

  return ownOf(ownOf(model?.entities, entity)?.fields, field)
}

export function resolveValue(
  ref: string,
  platform: Platform,
  model: Model | undefined,
): ResolvedValue | undefined {
  if (ref.includes('.')) {
    const field = modelFieldOf(ref, model)

    return field === undefined ? undefined : modelValueOf(field)
  }

  const value = ownOf(platform.values, ref)

  return value === undefined ? undefined : keywordsOf(value)
}

/** The value a parameter of an action of the model takes: that of the field it sets. */
function modelParameterValueOf(action: string, param: string, model: Model | undefined) {
  const [entity = '', name = ''] = action.split('.')
  const field = ownOf(ownOf(ownOf(model?.entities, entity)?.actions, name)?.params, param)
  const found = field === undefined ? undefined : modelFieldOf(`${entity}.${field}`, model)

  return found === undefined ? {} : modelValueOf(found)
}

export function parameterValueOf(
  action: string,
  param: string,
  platform: Platform,
  model: Model | undefined,
): ResolvedValue {
  if (!action.startsWith(PLATFORM)) {
    return modelParameterValueOf(action, param, model)
  }

  const declared = ownOf(platform.actions, action.slice(PLATFORM.length))
  const parameter = ownOf(declared?.params, param)

  if (declared === undefined || parameter === undefined) {
    return {}
  }

  const referred =
    parameter.value === undefined ? {} : (resolveValue(parameter.value, platform, model) ?? {})
  const sizes = param === SIZE ? declared.paged?.sizes : undefined

  return keywordsOf({
    ...narrowed(referred, keywordsOf(parameter)),
    ...(sizes === undefined ? {} : { enum: sizes }),
  })
}

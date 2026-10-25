/**
 * The codes a failure of an action shows, from what the contract already says about the action,
 * so no screen repeats them. A platform action declares its codes in `platform.yaml`. An action
 * of the model fails with:
 *
 * - `forbidden` first, when its entity says who may change it (`x-perch.can`);
 * - then, for each parameter in the order the action lists them, the codes of the field it sets
 *   (not a new id, not a read-only field), in this order: `<field>-required` for a `minLength`
 *   of 1, `<field>-too-short` for a larger one, `<field>-too-long` for a `maxLength`,
 *   `<field>-invalid` for a `pattern` or a `format`, `<field>-taken` when the field alone is
 *   unique; a field's name in a code is kebab-case (`display_name` gives `display-name-required`);
 * - `failed` last, for any other reason.
 */

import type { Model, ModelEntity, ModelField } from '../model'

/** What a failure of an action shows: its codes, and per parameter the codes of its field. */
export interface Failure {
  readonly codes: readonly string[]
  readonly params: Readonly<Record<string, readonly string[]>>
}

/**
 * The failure of an action; `unloaded` while the file that declares such actions does not load
 * (its own problems say why); undefined for an action neither the model nor the platform has.
 */
export type FailureOf = (action: string) => Failure | 'unloaded' | undefined

/** The codes of a failure, none when the action is unknown or its file does not load. */
export const failureCodes = (failure: ReturnType<FailureOf>): readonly string[] =>
  typeof failure === 'object' ? failure.codes : []

/** The codes of a failure an action of the platform declares, by its name without `platform.`. */
export type PlatformCodes = Readonly<Record<string, { readonly codes: readonly string[] }>>

const PLATFORM = 'platform.'
const NEW_ID = '$id'

/** The values in order, each once. */
export const unionOf = (lists: ReadonlyArray<readonly string[]>): string[] => [
  ...new Set(lists.flat()),
]

function fieldCodesOf(entity: ModelEntity, name: string, field: ModelField): string[] {
  const code = name.replaceAll('_', '-')
  const unique = entity.unique.some((set) => set.length === 1 && set[0] === name)
  const { minLength, maxLength, pattern, format } = field

  return [
    ...(minLength === 1 ? [`${code}-required`] : []),
    ...(minLength !== undefined && minLength > 1 ? [`${code}-too-short`] : []),
    ...(maxLength === undefined ? [] : [`${code}-too-long`]),
    ...(pattern === undefined && format === undefined ? [] : [`${code}-invalid`]),
    ...(unique ? [`${code}-taken`] : []),
  ]
}

function modelFailureOf(model: Model, action: string): Failure | undefined {
  const [entityName = '', actionName = ''] = action.split('.')
  const entity = model.entities[entityName]
  const params = entity?.actions[actionName]?.params

  if (entity === undefined || params === undefined) {
    return undefined
  }

  const byParam = Object.entries(params).flatMap(([param, name]) => {
    const field = name === NEW_ID ? undefined : entity.fields[name]
    const codes = field === undefined || field.readonly ? [] : fieldCodesOf(entity, name, field)

    return codes.length === 0 ? [] : [[param, codes] as const]
  })

  return {
    codes: unionOf([
      entity.can === undefined ? [] : ['forbidden'],
      ...byParam.map(([, codes]) => codes),
      ['failed'],
    ]),
    params: Object.fromEntries(byParam),
  }
}

/** The failures of the actions of `model` (undefined when it does not load) and the platform. */
export const failuresOf =
  (model: Model | undefined, platform: PlatformCodes | undefined): FailureOf =>
  (action) => {
    if (action.startsWith(PLATFORM)) {
      if (platform === undefined) {
        return 'unloaded'
      }

      const codes = platform[action.slice(PLATFORM.length)]?.codes

      return codes === undefined ? undefined : { codes, params: {} }
    }

    return model === undefined ? 'unloaded' : modelFailureOf(model, action)
  }

/**
 * The codes a failure of an action shows, from what the contract already says about the action,
 * so no screen repeats them, and per parameter the codes that concern it. A code of a field is
 * named after it and ends with a suffix of `FIELD_CODE_SUFFIXES`, each naming a constraint.
 *
 * A platform action declares its codes in `platform.yaml`. From version 3 each code concerns the
 * parameters it is attributed to (`attributedCodes`): the one it is named after,
 * `<parameter>-<suffix>` with the parameter in kebab-case (`currentPassword` gives
 * `current-password-rejected`), and each one whose `codes` list it; a code the action does not
 * declare is never attributed. Before version 3 its codes concern no parameter.
 *
 * An action of the model fails with:
 *
 * - `forbidden` first, when its entity says who may change it (`x-perch.can`);
 * - then, for each parameter in the order the action lists them, the codes of the field it sets
 *   (not a new id, not a read-only field), each suffix whose constraint the field has, in the
 *   order of the table: `<field>-required` for a `minLength` of 1, `<field>-too-short` for a
 *   larger one, `<field>-too-long` for a `maxLength`, `<field>-invalid` for a `pattern` or a
 *   `format` (its `enum` names none), `<field>-taken` when the field alone is unique, never
 *   `<field>-rejected`; a field's name in a code is kebab-case (`display_name` gives
 *   `display-name-required`);
 * - `failed` last, for any other reason.
 */

import { kebab } from '../../kebab'
import type { PlatformParameter } from '../../schemas'
import type { Model, ModelEntity, ModelField } from '../model'
import type { Platform } from '../screens'

/** What a failure of an action shows: its codes, and per parameter the codes that concern it. */
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

/** A platform action as its failure reads it: the codes it declares and its parameters. */
interface PlatformFailure {
  readonly codes: readonly string[]
  readonly params: Readonly<Record<string, PlatformParameter>>
}

/** The actions of the platform by their name without `platform.`, as their failures read them. */
export type PlatformFailures = Readonly<Record<string, PlatformFailure>>

/** The version from which a code of a platform action concerns the parameters it is attributed to. */
export const ATTRIBUTION_EDITION = 3

/**
 * The constraints a code of a field is named after: those of a resolved value, or those of a
 * field of the model, whose `format` may be any.
 */
export interface FieldConstraints {
  readonly enum?: readonly unknown[] | undefined
  readonly minLength?: number | undefined
  readonly maxLength?: number | undefined
  readonly pattern?: string | undefined
  readonly format?: string | undefined
  readonly minimum?: number | undefined
  readonly maximum?: number | undefined
}

export type FieldCodeSuffix =
  | 'required'
  | 'too-short'
  | 'too-long'
  | 'invalid'
  | 'taken'
  | 'rejected'

const PLATFORM = 'platform.'
const NEW_ID = '$id'

/** The keywords that constrain a value, its type aside. */
const CONSTRAINTS = [
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
] as const satisfies ReadonlyArray<keyof FieldConstraints>

/** Whether a value has any constraint, its type aside. */
export const constrains = (value: FieldConstraints): boolean =>
  CONSTRAINTS.some((keyword) => value[keyword] !== undefined)

/**
 * The suffixes a code of a field ends with, in the order a field gives its codes: each with
 * whether a value has the constraint it names (`holds`) and that constraint in words.
 */
export const FIELD_CODE_SUFFIXES: ReadonlyArray<{
  readonly suffix: FieldCodeSuffix
  readonly holds: (value: FieldConstraints) => boolean
  readonly constraint: string
}> = [
  {
    suffix: 'required',
    holds: ({ minLength }) => minLength !== undefined && minLength >= 1,
    constraint: 'minLength of 1 or more',
  },
  {
    suffix: 'too-short',
    holds: ({ minLength }) => minLength !== undefined && minLength > 1,
    constraint: 'minLength above 1',
  },
  {
    suffix: 'too-long',
    holds: ({ maxLength }) => maxLength !== undefined,
    constraint: 'maxLength',
  },
  {
    suffix: 'invalid',
    holds: (value) =>
      value.pattern !== undefined || value.format !== undefined || value.enum !== undefined,
    constraint: 'pattern, format or enum',
  },
  { suffix: 'taken', holds: () => true, constraint: 'uniqueness' },
  { suffix: 'rejected', holds: constrains, constraint: 'constraint' },
]

/** The code of a field named after the parameter `param` with `suffix`: `current-password-rejected`. */
export const codeNamedAfter = (param: string, suffix: FieldCodeSuffix): string =>
  `${kebab(param)}-${suffix}`

/** The values in order, each once. */
export const unionOf = (lists: ReadonlyArray<readonly string[]>): string[] => [
  ...new Set(lists.flat()),
]

/**
 * Whether a field of the model gives the code of `suffix` once its constraint holds: `required`
 * only where no longer minimum says `too-short`, `taken` only when the field alone is unique,
 * `rejected` never.
 */
function modelGives(suffix: FieldCodeSuffix, tooShort: boolean, unique: boolean): boolean {
  switch (suffix) {
    case 'required':
      return !tooShort
    case 'taken':
      return unique
    case 'rejected':
      return false
    default:
      return true
  }
}

function fieldCodesOf(entity: ModelEntity, name: string, field: ModelField): string[] {
  const code = name.replaceAll('_', '-')
  const unique = entity.unique.some((set) => set.length === 1 && set[0] === name)
  const { minLength, maxLength, pattern, format } = field
  const constraints: FieldConstraints = { minLength, maxLength, pattern, format }
  const held = FIELD_CODE_SUFFIXES.filter(({ holds }) => holds(constraints))
  const tooShort = held.some(({ suffix }) => suffix === 'too-short')

  return held
    .filter(({ suffix }) => modelGives(suffix, tooShort, unique))
    .map(({ suffix }) => `${code}-${suffix}`)
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

/** Per parameter of a platform action, the codes it declares that concern it, in their order. */
function attributionOf({ codes, params }: PlatformFailure): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(params).flatMap(([param, { codes: listed = [] }]) => {
      const named = FIELD_CODE_SUFFIXES.map(({ suffix }) => codeNamedAfter(param, suffix))
      const own = codes.filter((code) => named.includes(code) || listed.includes(code))

      return own.length === 0 ? [] : [[param, own] as const]
    }),
  )
}

/** The declared action `platform.<name>` names, if the platform has it. */
function declaredOf(action: string, platform: PlatformFailures): PlatformFailure | undefined {
  const name = action.slice(PLATFORM.length)

  return action.startsWith(PLATFORM) && Object.hasOwn(platform, name) ? platform[name] : undefined
}

/**
 * Per parameter of the platform action `action`, named as a binding names it
 * (`platform.<name>`), the codes it declares that concern that parameter, in their order; none
 * for an action the platform does not declare or one of the model.
 */
export function attributedCodes(
  action: string,
  platform: Platform,
): Readonly<Record<string, readonly string[]>> {
  const declared = declaredOf(action, platform.actions)

  return declared === undefined ? {} : attributionOf(declared)
}

/**
 * The failures of the actions of `model` (undefined when it does not load) and of the platform
 * (likewise), as a contract at version `edition` reads them.
 */
export const failuresOf =
  (model: Model | undefined, platform: PlatformFailures | undefined, edition: number): FailureOf =>
  (action) => {
    if (action.startsWith(PLATFORM)) {
      if (platform === undefined) {
        return 'unloaded'
      }

      const declared = declaredOf(action, platform)

      return declared === undefined
        ? undefined
        : {
            codes: declared.codes,
            params: edition >= ATTRIBUTION_EDITION ? attributionOf(declared) : {},
          }
    }

    return model === undefined ? 'unloaded' : modelFailureOf(model, action)
  }

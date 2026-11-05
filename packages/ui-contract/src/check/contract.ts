/**
 * The contract as the check reads it, the contract files, the activities and the scenarios,
 * and the lookups its rules share: the declared anchors, the refs of an anchor's binding and
 * what each names in the model, a field of the model, a known anchor (declared, or a declared
 * base with a suffix it lists in `derived`), the states and choice values of the vocabulary,
 * and a problem located in a screen's file, the platform file or another file at a line.
 */

import { baseOf, testIdFor, VISIBILITY_BUTTON, VISIBILITY_VALUES } from '../anchors'
import {
  type Activity,
  type AnchorDef,
  type BindingRef,
  CONFIRM_RULE_ROW,
  jsonPath,
  type Lines,
  type Model,
  PLATFORM_FILE,
  type Problem,
  type Screen,
  type ScreensFile,
  TOAST_RULE_ROW,
  type Vocabulary,
  type WrittenDescription,
} from '../files'
import type { Scenario } from '../scenarios'

export interface Contract {
  readonly vocabulary: Vocabulary
  readonly screens: ScreensFile
  readonly model: Model
  /** The activities of `contract/domain/activities`, sorted by the path of their files. */
  readonly activities: Activity[]
  /** The line of each key and item of each activity's file, by the activity's id. */
  readonly activityLines: ReadonlyMap<string, Lines>
  /** The scenarios of `tests/e2e/scenarios`, sorted by their ids. */
  readonly scenarios: Scenario[]
  /** The line of each field of each scenario's file, by the scenario's id. */
  readonly scenarioLines: ReadonlyMap<string, Lines>
  /**
   * Every description the files of `contract/domain` write, by its place, as they write it
   * (`readDescriptions`): never one the engine derives or the loader fills in.
   */
  readonly descriptions: readonly WrittenDescription[]
}

export interface DeclaredAnchor {
  readonly anchor: string
  readonly def: AnchorDef
  readonly screen: Screen
  /** Where the anchor is declared: `screens[i].anchors["<anchor>"]`. */
  readonly at: readonly PropertyKey[]
}

export const declaredAnchors = (screens: ScreensFile): DeclaredAnchor[] =>
  screens.screens.flatMap((screen, index) =>
    Object.entries(screen.anchors).map(([anchor, def]) => ({
      anchor,
      def,
      screen,
      at: ['screens', index, 'anchors', anchor],
    })),
  )

/** The two answers of a question the frame asks: going on, and staying. */
export const ANSWERS = ['confirm-button', 'cancel-button'] as const

/** The refs of an anchor's binding, one or a list, each at its path under the anchor. */
export function bindingRefsOf(
  def: AnchorDef,
): Array<{ readonly ref: BindingRef; readonly at: readonly PropertyKey[] }> {
  const { binding } = def

  if (binding === undefined) {
    return []
  }

  return Array.isArray(binding)
    ? binding.map((ref, index) => ({ ref, at: ['binding', index] }))
    : [{ ref: binding, at: ['binding'] }]
}

/** How an action of the platform is named in a binding: `platform.sign-out`. */
export const PLATFORM_ACTION = 'platform.'

/** The entity and its member that `entity.member` names: a field or an action. */
export function entityMemberOf(path: string): { entity: string; member: string } {
  const [entity = '', member = ''] = path.split('.')

  return { entity, member }
}

/**
 * What a binding ref names in the model: a field (`model`), or an action of an entity
 * (`action` outside the platform); a route or a platform action names nothing there.
 */
export function modelTargetOf(
  ref: BindingRef,
): { kind: 'field' | 'action'; entity: string; member: string } | undefined {
  if ('model' in ref) {
    return { kind: 'field', ...entityMemberOf(ref.model) }
  }

  return 'action' in ref && !ref.action.startsWith(PLATFORM_ACTION)
    ? { kind: 'action', ...entityMemberOf(ref.action) }
    : undefined
}

/** Whether `record` has `key` as its own key (never a name of the object prototype). */
export const has = (record: object, key: string): boolean => Object.hasOwn(record, key)

/** The own entry `key` of `record`, if any. */
export const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

/** Why `entity.field` names no field of the model, or undefined when it names one. */
export function fieldProblem(model: Model, path: string): string | undefined {
  const { entity: entityName, member: field } = entityMemberOf(path)
  const entity = own(model.entities, entityName)

  if (entity === undefined) {
    return `no entity "${entityName}" in the model`
  }

  return has(entity.fields, field) ? undefined : `entity "${entityName}" has no field "${field}"`
}

/** A problem at a JSON path of the screens as the rules read them (`ScreensFile`). */
export type InScreens = (path: readonly PropertyKey[], message: string) => Problem

/**
 * Where a JSON path of `screens` is written: `screens[i]...` in the file of screen `i`,
 * at the path inside it (`anchors["x"].kind`); `version` and `platform...` in the platform
 * file, at the path inside it (`actions["x"].codes[0]`).
 */
export const locate =
  (screens: ScreensFile): InScreens =>
  (path, message) => {
    const [section, index, ...inside] = path

    if (section !== 'screens') {
      const at = section === 'platform' ? path.slice(1) : path

      return { file: PLATFORM_FILE, message: `${jsonPath(at)}: ${message}` }
    }

    const file = typeof index === 'number' ? screens.files[index] : undefined

    if (file === undefined) {
      throw new Error(`no screen file holds ${jsonPath(path)}`)
    }

    return { file, message: `${jsonPath(inside)}: ${message}` }
  }

/** A problem of a file, at `line` when it is known. */
export const inFile = (file: string, message: string, line?: number): Problem =>
  line === undefined ? { file, message } : { file, line, message }

/**
 * Whether an anchor is declared, or derived from a declared base with a suffix that base
 * lists in `derived`: a suffix of the vocabulary alone names no element the base renders.
 */
export function knownAnchors(contract: Contract): (anchor: string) => boolean {
  const defs = new Map(declaredAnchors(contract.screens).map(({ anchor, def }) => [anchor, def]))
  const suffixes = Object.keys(contract.vocabulary.suffixes)

  return (anchor) => {
    if (defs.has(anchor)) {
      return true
    }

    const base = baseOf(anchor, suffixes)
    const derived = base === undefined ? undefined : defs.get(base)?.derived

    return base !== undefined && (derived ?? []).includes(anchor.slice(base.length + 1))
  }
}

/**
 * The visibility-buttons the contract declares: `<anchor>.visibility-button` for each anchor
 * that lists the suffix in `derived`. Presentation only: never an event of a flow or an activity,
 * and never a value an action takes.
 */
export const visibilityButtonsOf = (screens: ScreensFile): Set<string> =>
  new Set(
    declaredAnchors(screens)
      .filter(({ def }) => (def.derived ?? []).includes(VISIBILITY_BUTTON))
      .map(({ anchor }) => testIdFor(anchor, VISIBILITY_BUTTON)),
  )

/** The problem of a visibility-button named as more than presentation: `never` says as what. */
export const presentationOnly = (
  anchor: string,
  never:
    | 'an event of a flow'
    | 'an event of an activity'
    | 'a value an action takes'
    | 'a value a search carries',
): string => `"${anchor}" is a ${VISIBILITY_BUTTON}: presentation only, never ${never}`

/**
 * The codes of the contract: the vocabulary's rows, the rule rows aside (they are no codes), and
 * each toast and question code the loader derived, which the rule rows stand for.
 */
export const codesOf = (vocabulary: Vocabulary, screens: ScreensFile): Set<string> =>
  new Set([
    ...Object.keys(vocabulary.codes).filter(
      (code) => code !== TOAST_RULE_ROW && code !== CONFIRM_RULE_ROW,
    ),
    ...screens.toasts.map(({ code }) => code),
    ...screens.questions.map(({ code }) => code),
  ])

/** Every state of the vocabulary: app, container and row states. */
export const statesOf = (vocabulary: Vocabulary): Set<string> =>
  new Set([
    ...Object.keys(vocabulary.appStates),
    ...Object.keys(vocabulary.containerStates),
    ...Object.keys(vocabulary.rowStates),
  ])

/** A choice value written as a pattern (`^[a-z]+$`) stands for every value it matches. */
export const isPattern = (value: string): boolean => value.startsWith('^')

const matches = (pattern: string, value: string): boolean => {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

/** Whether `value` is one of the choice-value rows of an anchor, or matches its pattern row. */
export const isValueOf = (rows: Readonly<Record<string, string>>, value: string): boolean =>
  Object.keys(rows).some((row) => row === value || (isPattern(row) && matches(row, value)))

/** Whether `value` is a row of some anchor's choice values, or matches a pattern row. */
export const isChoiceValue = (vocabulary: Vocabulary, value: string): boolean =>
  Object.values(vocabulary.choiceValues).some((rows) => isValueOf(rows, value))

/**
 * Whether `value` is a `data-value` of the contract: a choice value, or, once an input renders a
 * visibility-button, one of the values its suffix defines (`show`, `hide`).
 */
export function contractValues(contract: Contract): (value: string) => boolean {
  const visibility = visibilityButtonsOf(contract.screens).size > 0

  return (value) =>
    isChoiceValue(contract.vocabulary, value) || (visibility && has(VISIBILITY_VALUES, value))
}

/** The paths of every binding of every screen. */
export const bindingPaths = (screens: ScreensFile): Set<string> =>
  new Set(screens.screens.flatMap((screen) => screen.bindings.map(({ path }) => path)))

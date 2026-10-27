/**
 * Rule 1: the screen files, the platform file and the model speak only the vocabulary's
 * words. Every kind, derived suffix, code, state, role and screen name the screens and the
 * platform use is listed in `vocabulary.md`, and so is every role the model grants a
 * permission to; every choice value belongs to an anchor that exists; every code listed is
 * used somewhere; the platform's status states and reserved anchors are the vocabulary's own.
 * A code the loader derived on the toast anchor needs no row: the rule row
 * `<object>-<verb>ed` stands for them all, wanted once one is derived.
 */

import { screenOf } from '../anchors'
import {
  jsonPath,
  MODEL_FILE,
  type Problem,
  type ScreensFile,
  TOAST_RULE_ROW,
  VOCABULARY_FILE,
} from '../files'

import {
  type Contract,
  declaredAnchors,
  has,
  type InScreens,
  isPattern,
  knownAnchors,
  locate,
  statesOf,
} from './contract'

const FRAME_SCREEN = 'app-shell'

/** Each value of `values` that `listed` lacks, as a problem at `at[index]` (`inScreens`). */
const unlistedIn =
  (inScreens: InScreens) =>
  (
    values: readonly string[] | undefined,
    at: readonly PropertyKey[],
    listed: ReadonlySet<string> | Record<string, unknown>,
    noun: string,
  ): Problem[] =>
    (values ?? []).flatMap((value, index) =>
      (listed instanceof Set ? listed.has(value) : has(listed, value))
        ? []
        : [inScreens([...at, index], `"${value}" is not ${noun} of the vocabulary`)],
    )

function screenProblems(contract: Contract): Problem[] {
  const { vocabulary, screens } = contract
  const inScreens = locate(screens)
  const unlisted = unlistedIn(inScreens)
  const names = Object.keys(vocabulary.screenNames)
  const states = statesOf(vocabulary)
  const anchors = declaredAnchors(screens)
  // A code the loader derived on the toast anchor is vouched for by the rule row, not a row of its own.
  const codesFor = (anchor: string): Readonly<Record<string, unknown>> => {
    const derived = screens.toasts.filter((toast) => toast.anchor === anchor)

    return derived.length === 0
      ? vocabulary.codes
      : { ...vocabulary.codes, ...Object.fromEntries(derived.map(({ code }) => [code, true])) }
  }

  return screens.screens.flatMap((screen, index) => [
    ...(has(vocabulary.screenNames, screen.id)
      ? []
      : [
          inScreens(
            ['screens', index, 'id'],
            `"${screen.id}" is not a screen name of the vocabulary`,
          ),
        ]),
    ...anchors
      .filter((declared) => declared.screen === screen)
      .flatMap(({ anchor, def, at }) => [
        ...(screenOf(anchor, names) === undefined
          ? [inScreens(at, 'starts with no screen name of the vocabulary')]
          : []),
        ...(has(vocabulary.kinds, def.kind)
          ? []
          : [inScreens([...at, 'kind'], `"${def.kind}" is not a kind of the vocabulary`)]),
        ...unlisted(def.derived, [...at, 'derived'], vocabulary.suffixes, 'a derived suffix'),
        ...unlisted(def.codes, [...at, 'codes'], codesFor(anchor), 'a code'),
        ...unlisted(def.states, [...at, 'states'], states, 'a state'),
        ...unlisted(def.roles, [...at, 'roles'], vocabulary.roles, 'a role'),
      ]),
    ...screen.bindings.flatMap((binding, at) =>
      unlisted(
        binding.roles,
        ['screens', index, 'bindings', at, 'roles'],
        vocabulary.roles,
        'a role',
      ),
    ),
  ])
}

/** The roles of every entity's `x-perch.can`, at their path in the model. */
const modelRoleProblems = ({ vocabulary, model }: Contract): Problem[] =>
  Object.values(model.entities).flatMap((entity) =>
    Object.keys(entity.can ?? {})
      .filter((role) => !has(vocabulary.roles, role))
      .map((role) => ({
        file: MODEL_FILE,
        message: `${jsonPath(['$defs', entity.name, 'x-perch', 'can', role])}: "${role}" is not a role of the vocabulary`,
      })),
  )

function platformProblems({ vocabulary, screens }: Contract): Problem[] {
  const { actions, status, reserved } = screens.platform
  const inScreens = locate(screens)
  const unlisted = unlistedIn(inScreens)
  const appStates = Object.keys(vocabulary.appStates)
  const frame = screens.screens.find((screen) => screen.id === FRAME_SCREEN)

  return [
    ...Object.entries(actions).flatMap(([name, action]) => [
      ...unlisted(action.roles, ['platform', 'actions', name, 'roles'], vocabulary.roles, 'a role'),
      ...unlisted(action.codes, ['platform', 'actions', name, 'codes'], vocabulary.codes, 'a code'),
    ]),
    ...(status.states.join(',') === appStates.join(',')
      ? []
      : [
          inScreens(
            ['platform', 'status', 'states'],
            `must equal the app states of the vocabulary, in order: ${appStates.join(', ')}`,
          ),
        ]),
    ...Object.keys(vocabulary.reserved)
      .filter((anchor) => !reserved.includes(anchor))
      .map((anchor) =>
        inScreens(
          ['platform', 'reserved'],
          `misses the reserved anchor "${anchor}" of the vocabulary`,
        ),
      ),
    ...reserved.flatMap((anchor, index) => [
      ...(has(vocabulary.reserved, anchor)
        ? []
        : [
            inScreens(
              ['platform', 'reserved', index],
              `"${anchor}" is not a reserved anchor of the vocabulary`,
            ),
          ]),
      ...(frame !== undefined && has(frame.anchors, anchor)
        ? []
        : [
            inScreens(
              ['platform', 'reserved', index],
              `"${anchor}" is not an anchor of the ${FRAME_SCREEN} screen`,
            ),
          ]),
    ]),
  ]
}

const inVocabulary = (message: string): Problem => ({ file: VOCABULARY_FILE, message })

function validPattern(pattern: string): boolean {
  try {
    new RegExp(pattern)

    return true
  } catch {
    return false
  }
}

function choiceValueProblems(contract: Contract): Problem[] {
  const known = knownAnchors(contract)

  return Object.entries(contract.vocabulary.choiceValues).flatMap(([anchor, rows]) => {
    const values = Object.keys(rows)
    const patterns = values.filter(isPattern)

    return [
      ...patterns
        .filter((pattern) => !validPattern(pattern))
        .map((pattern) =>
          inVocabulary(`choice values of "${anchor}": "${pattern}" is not a valid pattern`),
        ),
      ...(patterns.length > 0 && values.length > 1
        ? [inVocabulary(`choice values of "${anchor}": a pattern is the only row of its anchor`)]
        : []),
      ...(known(anchor)
        ? []
        : [inVocabulary(`choice values of "${anchor}": no such anchor in the screens`)]),
    ]
  })
}

/**
 * The codes named by an anchor's `codes` or a platform action; a flow shows only codes its
 * anchors carry (rule 8).
 */
const usedCodes = (screens: ScreensFile): Set<string> =>
  new Set([
    ...declaredAnchors(screens).flatMap(({ def }) => def.codes ?? []),
    ...Object.values(screens.platform.actions).flatMap(({ codes }) => codes),
    ...(screens.toasts.length > 0 ? [TOAST_RULE_ROW] : []),
  ])

/** The derived toasts want the vocabulary's rule row. */
function toastRuleProblems({ vocabulary, screens }: Contract): Problem[] {
  const [first] = screens.toasts

  if (first === undefined || has(vocabulary.codes, TOAST_RULE_ROW)) {
    return []
  }

  const codes = screens.toasts.map(({ code }) => code).join(', ')

  return [
    inVocabulary(
      `section "Codes": the toasts derived on ${first.anchor} (${codes}) want the rule row \`${TOAST_RULE_ROW}\``,
    ),
  ]
}

function unusedCodeProblems({ vocabulary, screens }: Contract): Problem[] {
  const used = usedCodes(screens)

  return Object.keys(vocabulary.codes)
    .filter((code) => !used.has(code))
    .map((code) => inVocabulary(`code "${code}" is documented but unused`))
}

export const vocabularyProblems = (contract: Contract): Problem[] => [
  ...screenProblems(contract),
  ...modelRoleProblems(contract),
  ...platformProblems(contract),
  ...choiceValueProblems(contract),
  ...unusedCodeProblems(contract),
  ...toastRuleProblems(contract),
]

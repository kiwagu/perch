/**
 * The manifest, built only from the contract folder (the vocabulary, the screen files, the
 * platform file, the activities and the model) and the scenario files of
 * `tests/e2e/scenarios/`: the vocabulary as tables with instructions, the screens verbatim
 * with an example link on each binding, the platform section as written with each invariant's
 * derived actions, the activities verbatim, the scenarios parsed, every declared anchor by name with its screen (with a field's composite
 * opt-in, and on each anchor a composite derives where it comes from), each derived suffix with
 * the kind, meaning and values of the part it marks, the composites and the field states of the
 * vocabulary, and the model document. An anchor the screen file leaves undescribed carries the
 * description the engine says of it, and a text field the value it takes. The platform's values
 * and the model document are those the contract loads, each length resolved, and from version 6
 * the contract section names the default length they took. Last, the text of each rule of the
 * engine that the manifest or its schema names (`rulesOf`).
 */

import {
  ANCHOR_ATTRIBUTES,
  ANCHOR_PATTERN,
  kindOf,
  PAGE_HELPER,
  TEXT_FIELD_KINDS,
  VISIBILITY_BUTTON,
  VISIBILITY_VALUES,
} from '../anchors'
import { fieldStatesOf } from '../check'
import {
  type Activity,
  CONFIRM_RULE_ROW,
  DEFAULTS_EDITION,
  type DescriptionContext,
  derivedDescriptionOf,
  describedOf,
  failuresOf,
  fieldValueOf,
  invariantActions,
  type Model,
  type ResolvedValue,
  renderedRule,
  type Screen,
  type ScreensFile,
  type Terms,
  TOAST_RULE_ROW,
  type Vocabulary,
} from '../files'
import { exampleOf } from '../routes'
import type { Scenario } from '../scenarios'

import { instructionsOf } from './instructions'
import type { Manifest, Product } from './manifest.types'
import { rulesOf } from './rules'

/** The app state in which a test may start. */
const READY = 'ready'

type WrittenValue = NonNullable<Manifest['ids'][string]['value']>

/** A value as the manifest writes it: its enum a list of its own. */
const writtenValue = ({ enum: values, ...rest }: ResolvedValue): WrittenValue =>
  values === undefined ? rest : { ...rest, enum: [...values] }

export interface ManifestInput {
  readonly vocabulary: Vocabulary
  readonly screens: ScreensFile
  readonly model: Model
  readonly activities: Activity[]
  readonly scenarios: Scenario[]
  /** The terms file, when the contract writes one. */
  readonly terms?: Terms | undefined
  readonly product: Product
  /** When the manifest is built; now by default. */
  readonly now?: Date
}

const mapValues = <T>(
  record: Readonly<Record<string, T>>,
  value: (entry: T) => string,
): Record<string, string> =>
  Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, value(entry)]))

const located = ({ where, meaning }: { where: string; meaning: string }): string =>
  `${where}: ${meaning}`

function idsOf(screens: ScreensFile, vocabulary: Vocabulary, model: Model): Manifest['ids'] {
  return Object.fromEntries(
    screens.screens.flatMap((screen) =>
      Object.entries(screen.anchors).map(([anchor, def]) => {
        const {
          kind,
          binding,
          codes,
          ranked,
          fields,
          dataId,
          dataValue,
          states,
          derived,
          roles,
          own,
          with: withEntries,
          without,
          holdsInput,
          marksState,
          secret,
          required,
          asks,
          leaves,
          composite,
          derivedFrom,
        } = def
        const fieldStates = fieldStatesOf(def, vocabulary)
        const value = TEXT_FIELD_KINDS.has(kind)
          ? fieldValueOf(anchor, screen, screens.platform, model)
          : undefined

        return [
          anchor,
          {
            kind,
            screen: screen.id,
            ...(binding === undefined ? {} : { binding }),
            ...(codes === undefined ? {} : { codes }),
            ...(ranked === undefined ? {} : { ranked }),
            ...(fields === undefined ? {} : { fields }),
            ...(dataId === undefined ? {} : { dataId }),
            ...(dataValue === undefined ? {} : { dataValue }),
            ...(states === undefined ? {} : { states }),
            ...(derived === undefined ? {} : { derived }),
            ...(roles === undefined ? {} : { roles }),
            ...(own === undefined ? {} : { own }),
            ...(withEntries === undefined ? {} : { with: withEntries }),
            ...(without === undefined ? {} : { without }),
            ...(holdsInput === undefined ? {} : { holdsInput }),
            ...(marksState === undefined ? {} : { marksState }),
            ...(secret === undefined ? {} : { secret }),
            ...(required === undefined ? {} : { required }),
            ...(asks === undefined ? {} : { asks }),
            ...(leaves === undefined ? {} : { leaves }),
            ...(composite === undefined ? {} : { composite }),
            ...(derivedFrom === undefined ? {} : { derivedFrom }),
            ...(fieldStates.length === 0 ? {} : { fieldStates: [...fieldStates] }),
            ...(value === undefined ? {} : { value: writtenValue(value) }),
          },
        ]
      }),
    ),
  )
}

/**
 * The screens as written, each binding with its example link (`exampleOf`) and each anchor with
 * the description it carries (`describedOf`): the written one, else the one the engine says.
 */
const screensOf = (screens: readonly Screen[], context: DescriptionContext): Manifest['screens'] =>
  screens.map((screen) => ({
    ...screen,
    bindings: screen.bindings.map((binding) => ({ ...binding, example: exampleOf(binding).link })),
    anchors: Object.fromEntries(
      Object.entries(screen.anchors).map(([anchor, def]) => {
        const description = describedOf(def, derivedDescriptionOf(anchor, def, screen, context))

        return [anchor, description === undefined ? def : { ...def, description }]
      }),
    ),
  }))

const routeParamsOf = (screens: readonly Screen[]): Manifest['routeParams'] =>
  Object.fromEntries(
    screens.flatMap((screen) =>
      screen.bindings.flatMap(({ path, params }) =>
        params === undefined ? [] : [[path, params] as const],
      ),
    ),
  )

/**
 * Each derived suffix with the part it marks: its kind, the meaning of its suffix and the values
 * its suffix defines.
 */
const partsOf = (vocabulary: Vocabulary): Manifest['contract']['derivedParts'] =>
  Object.fromEntries(
    Object.entries(vocabulary.suffixes).map(([suffix, description]) => [
      suffix,
      {
        kind: kindOf(suffix),
        description,
        ...(suffix === VISIBILITY_BUTTON ? { values: { ...VISIBILITY_VALUES } } : {}),
      },
    ]),
  )

/**
 * The platform as the manifest carries it: each invariant with its rule's values written in and
 * the actions that name it.
 */
function platformOf(platform: ScreensFile['platform']): Manifest['platform'] {
  const { invariants, ...rest } = platform

  if (invariants === undefined) {
    return rest
  }

  const actions = invariantActions(platform)

  return {
    ...rest,
    invariants: Object.fromEntries(
      Object.entries(invariants).map(([name, invariant]) => [
        name,
        { ...invariant, rule: renderedRule(invariant), actions: [...(actions[name] ?? [])] },
      ]),
    ),
  }
}

function contractOf(vocabulary: Vocabulary, screens: ScreensFile): Manifest['contract'] {
  const { defaults } = screens.platform

  return {
    version: screens.version,
    ...(screens.version < DEFAULTS_EDITION || defaults === undefined ? {} : { defaults }),
    idAttribute: ANCHOR_ATTRIBUTES.anchor,
    idPattern: ANCHOR_PATTERN.source,
    kinds: vocabulary.kinds,
    derivedSuffixes: vocabulary.suffixes,
    derivedParts: partsOf(vocabulary),
    attributes: mapValues(vocabulary.attributes, ({ on, meaning }) => `${on}: ${meaning}`),
    appStateAnchor: screens.platform.status.anchor,
    appStates: vocabulary.appStates,
    readyValue: READY,
    containerStates: vocabulary.containerStates,
    rowStates: mapValues(vocabulary.rowStates, located),
    // The rule rows are no codes: each code they stand for is listed with its action instead.
    codes: {
      ...mapValues(
        Object.fromEntries(
          Object.entries(vocabulary.codes).filter(
            ([code]) => code !== TOAST_RULE_ROW && code !== CONFIRM_RULE_ROW,
          ),
        ),
        located,
      ),
      ...Object.fromEntries(
        screens.toasts.map(({ anchor, code, action }) => [
          code,
          `\`${anchor}\`: the success of \`${action}\``,
        ]),
      ),
      ...Object.fromEntries(
        screens.questions.map(({ anchor, code, action }) => [
          code,
          `\`${anchor}\`: the question before \`${action}\``,
        ]),
      ),
    },
    choiceValues: vocabulary.choiceValues,
    roles: vocabulary.roles,
    screenNames: vocabulary.screenNames,
    reserved: Object.keys(vocabulary.reserved),
    composites: vocabulary.composites,
    fieldStates: vocabulary.fieldStates,
    pageHelper: PAGE_HELPER,
    instructions: instructionsOf(vocabulary, screens.platform, READY),
  }
}

export function buildManifest({
  vocabulary,
  screens,
  model,
  activities,
  scenarios,
  terms,
  product,
  now = new Date(),
}: ManifestInput): Manifest {
  const document = {
    $schema: './manifest.schema.json',
    manifestVersion: 1 as const,
    generatedAt: now.toISOString(),
    product,
    contract: contractOf(vocabulary, screens),
    ...(terms === undefined ? {} : { terms }),
    screens: screensOf(screens.screens, {
      screens: screens.screens,
      codes: vocabulary.codes,
      failureOf: failuresOf(model, screens.platform.actions, screens.version),
    }),
    routeParams: routeParamsOf(screens.screens),
    ids: idsOf(screens, vocabulary, model),
    platform: platformOf(screens.platform),
    activities,
    scenarios,
    model: model.document,
  }

  return { ...document, rules: rulesOf(document) }
}

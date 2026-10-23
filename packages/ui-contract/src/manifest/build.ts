/**
 * The manifest, built only from the contract folder (the vocabulary, the screen files, the
 * platform file, the activities and the model) and the scenario files of
 * `tests/e2e/scenarios/`: the vocabulary as tables with instructions, the screens verbatim
 * with an example link on each binding, the platform section and the activities verbatim,
 * the scenarios parsed, every declared anchor by name with its screen, and the model
 * document.
 */

import { ANCHOR_ATTRIBUTES, ANCHOR_PATTERN, PAGE_HELPER } from '../anchors'
import type { Activity, Model, Screen, ScreensFile, Vocabulary } from '../files'
import { exampleOf } from '../routes'
import type { Scenario } from '../scenarios'

import { instructionsOf } from './instructions'
import type { Manifest, Product } from './manifest.types'

/** The app state in which a test may start. */
const READY = 'ready'

export interface ManifestInput {
  readonly vocabulary: Vocabulary
  readonly screens: ScreensFile
  readonly model: Model
  readonly activities: Activity[]
  readonly scenarios: Scenario[]
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

function idsOf(screens: readonly Screen[]): Manifest['ids'] {
  return Object.fromEntries(
    screens.flatMap((screen) =>
      Object.entries(screen.anchors).map(
        ([
          anchor,
          { kind, binding, codes, fields, dataId, dataValue, states, derived, roles, own },
        ]) => [
          anchor,
          {
            kind,
            screen: screen.id,
            ...(binding === undefined ? {} : { binding }),
            ...(codes === undefined ? {} : { codes }),
            ...(fields === undefined ? {} : { fields }),
            ...(dataId === undefined ? {} : { dataId }),
            ...(dataValue === undefined ? {} : { dataValue }),
            ...(states === undefined ? {} : { states }),
            ...(derived === undefined ? {} : { derived }),
            ...(roles === undefined ? {} : { roles }),
            ...(own === undefined ? {} : { own }),
          },
        ],
      ),
    ),
  )
}

/** The screens as written, each binding with its example link (`exampleOf`). */
const screensOf = (screens: readonly Screen[]): Manifest['screens'] =>
  screens.map((screen) => ({
    ...screen,
    bindings: screen.bindings.map((binding) => ({ ...binding, example: exampleOf(binding).link })),
  }))

const routeParamsOf = (screens: readonly Screen[]): Manifest['routeParams'] =>
  Object.fromEntries(
    screens.flatMap((screen) =>
      screen.bindings.flatMap(({ path, params }) =>
        params === undefined ? [] : [[path, params] as const],
      ),
    ),
  )

function contractOf(vocabulary: Vocabulary, screens: ScreensFile): Manifest['contract'] {
  return {
    version: screens.version,
    idAttribute: ANCHOR_ATTRIBUTES.anchor,
    idPattern: ANCHOR_PATTERN.source,
    kinds: vocabulary.kinds,
    derivedSuffixes: vocabulary.suffixes,
    attributes: mapValues(vocabulary.attributes, ({ on, meaning }) => `${on}: ${meaning}`),
    appStateAnchor: screens.platform.status.anchor,
    appStates: vocabulary.appStates,
    readyValue: READY,
    containerStates: vocabulary.containerStates,
    rowStates: mapValues(vocabulary.rowStates, located),
    codes: mapValues(vocabulary.codes, located),
    choiceValues: vocabulary.choiceValues,
    roles: vocabulary.roles,
    screenNames: vocabulary.screenNames,
    reserved: Object.keys(vocabulary.reserved),
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
  product,
  now = new Date(),
}: ManifestInput): Manifest {
  return {
    $schema: './manifest.schema.json',
    manifestVersion: 1,
    generatedAt: now.toISOString(),
    product,
    contract: contractOf(vocabulary, screens),
    screens: screensOf(screens.screens),
    routeParams: routeParamsOf(screens.screens),
    ids: idsOf(screens.screens),
    platform: screens.platform,
    activities,
    scenarios,
    model: model.document,
  }
}

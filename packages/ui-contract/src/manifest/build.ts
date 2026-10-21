/**
 * The manifest, built from the three contract files only: the vocabulary as tables with
 * instructions, the screens, the platform section and the scenarios verbatim, every declared
 * anchor by name with its screen, and the model document.
 */

import { ANCHOR_ATTRIBUTES, ANCHOR_PATTERN, PAGE_HELPER } from '../anchors'
import type { Model, Screen, ScreensFile, Vocabulary } from '../files'

import { instructionsOf } from './instructions'
import type { Manifest, Product } from './manifest.types'

/** The app state in which a test may start. */
const READY = 'ready'

export interface ManifestInput {
  readonly vocabulary: Vocabulary
  readonly screens: ScreensFile
  readonly model: Model
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
        ([anchor, { kind, binding, codes, dataId, dataValue, states, derived, roles, own }]) => [
          anchor,
          {
            kind,
            screen: screen.id,
            ...(binding === undefined ? {} : { binding }),
            ...(codes === undefined ? {} : { codes }),
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
  product,
  now = new Date(),
}: ManifestInput): Manifest {
  return {
    $schema: './manifest.schema.json',
    manifestVersion: 1,
    generatedAt: now.toISOString(),
    product,
    contract: contractOf(vocabulary, screens),
    screens: screens.screens,
    routeParams: routeParamsOf(screens.screens),
    ids: idsOf(screens.screens),
    platform: screens.platform,
    scenarios: screens.scenarios,
    model: model.document,
  }
}

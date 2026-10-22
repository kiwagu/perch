/**
 * `ui-manifest/manifest.json`, the published contract built from `contract/`: the vocabulary
 * as tables with instructions for an agent, the screens verbatim, every declared anchor with
 * its screen, the platform, the scenarios parsed from their files and the model.
 */

import { z } from '@workspace/zod'

import {
  anchorSchema,
  baseAnchorSchema,
  codeSchema,
  kebabNameSchema,
  roleSchema,
  screenNameSchema,
  stateSchema,
} from '../names.schema'
import { scenarioSchema } from '../scenarios'

import { flatJsonSchema } from './flat-json-schema'
import { anchorBindingSchema, platformSchema, screenSchema } from './screens.schema'

/** A table of the vocabulary: its key, then what the key means. */
const tableOf = (key: z.ZodString, meaning: string, what: string) =>
  z.record(key, z.string().describe(meaning)).describe(what)

const instructionsSchema = z
  .strictObject({
    readiness: z.string().min(1).describe('When a page is ready for a test to act on it.'),
    language: z.string().min(1).describe('Which language the page speaks, and what to assert.'),
    session: z.string().min(1).describe('How a scenario starts and makes its accounts.'),
    screenMap: z.string().min(1).describe('How to read `screens` and the fields of an anchor.'),
    bindings: z.string().min(1).describe('Where each kind of binding points.'),
    model: z.string().min(1).describe('How to read `model` and its `x-perch` keyword.'),
    notices: z.string().min(1).describe('How to find the notice an action raises.'),
    scenarios: z.string().min(1).describe('How to read `scenarios` and their bracket references.'),
  })
  .describe('Prose instructions for an agent that drives the application.')

const contractSchema = z
  .strictObject({
    version: z.literal(1).describe('The version of the contract format.'),
    idAttribute: z.literal('data-testid').describe('The attribute that carries an anchor.'),
    idPattern: z.string().min(1).describe('The regular expression every rendered anchor matches.'),
    kinds: tableOf(kebabNameSchema, 'What an element of the kind is.', 'The kinds of anchors.'),
    derivedSuffixes: tableOf(
      kebabNameSchema,
      'The part of a composite the suffix marks.',
      'The suffixes of derived anchors: `<anchor>.<suffix>`.',
    ),
    attributes: tableOf(
      z.string(),
      '`<on>: <meaning>`: the elements that carry it, then what it holds.',
      'The attributes an anchored element or the page carries.',
    ),
    appStateAnchor: anchorSchema.describe('The anchor of the readiness line of the app.'),
    appStates: tableOf(stateSchema, 'What the state means.', 'The data-state values of the app.'),
    readyValue: stateSchema.describe('The app state in which a test may start.'),
    containerStates: tableOf(
      stateSchema,
      'What the state means.',
      'The data-state values of a list, a section or a page status.',
    ),
    rowStates: tableOf(
      stateSchema,
      '`<where>: <meaning>`: the anchor that takes it, then what it means.',
      'The data-state values of an item.',
    ),
    codes: tableOf(
      codeSchema,
      '`<where>: <meaning>`: the anchors that carry it, then what it means.',
      'The data-code values: what a message, error, toast or dialog says.',
    ),
    choiceValues: z
      .record(
        z.string(),
        tableOf(z.string(), 'What the value chooses.', 'The values the anchor carries.'),
      )
      .describe(
        'The data-value values by anchor; a value that starts with `^` is a pattern of values.',
      ),
    roles: tableOf(roleSchema, 'Who acts in the role.', 'The roles a device acts as.'),
    screenNames: tableOf(
      screenNameSchema,
      'The screen and its route.',
      'The screen names an anchor starts with.',
    ),
    reserved: z
      .array(baseAnchorSchema)
      .describe('The anchors the shell owns; a feature never declares them.'),
    pageHelper: z
      .literal('__perch.ui')
      .describe('Where development and e2e builds install the page helper on `window`.'),
    instructions: instructionsSchema,
  })
  .describe('The vocabulary of the contract, with instructions for an agent.')

const idSchema = z
  .strictObject({
    kind: kebabNameSchema.describe('The kind of the anchor.'),
    screen: screenNameSchema.describe('The id of the screen that declares the anchor.'),
    binding: anchorBindingSchema.optional(),
    codes: z.array(codeSchema).optional().describe('The data-code values the element carries.'),
    dataId: z.string().optional().describe('What the data-id of the element holds.'),
    dataValue: z
      .boolean()
      .optional()
      .describe('The element, or its derived options, carry a data-value of the choice values.'),
    states: z.array(stateSchema).optional().describe('The data-state values the element takes.'),
    derived: z
      .array(kebabNameSchema)
      .optional()
      .describe('The derived suffixes the element renders.'),
    roles: z.array(roleSchema).optional().describe('The roles that see the element.'),
    own: z.boolean().optional().describe('Shown to a member only on the entries it owns.'),
  })
  .describe('One declared anchor, as a test looks it up.')

export const manifestSchema = z
  .strictObject({
    $schema: z
      .string()
      .optional()
      .describe('The JSON Schema of the file: `./manifest.schema.json`.'),
    manifestVersion: z.literal(1).describe('The version of the manifest format.'),
    generatedAt: z.iso.datetime().describe('When the manifest was built, in ISO 8601.'),
    product: z
      .strictObject({
        name: z.string().min(1).describe('The product name.'),
        version: z.string().min(1).describe('The version of the root package.json.'),
        commit: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .nullable()
          .describe('The commit the manifest was built from, or null outside git.'),
      })
      .describe('The product the manifest describes.'),
    contract: contractSchema,
    screens: z
      .array(screenSchema)
      .describe('The screens of `contract/screens.json`, verbatim: routes, anchors, flows.'),
    routeParams: z
      .record(z.string(), flatJsonSchema)
      .describe('The path parameters by route path, for the routes that have any.'),
    ids: z
      .record(baseAnchorSchema, idSchema)
      .describe('Every declared anchor by name; a derived one is its base plus a suffix.'),
    platform: platformSchema,
    scenarios: z
      .array(scenarioSchema)
      .describe(
        'The end-to-end scenarios, parsed from their files under `tests/e2e/scenarios/`: the id is the path of a file without `.md`.',
      ),
    model: z
      .record(z.string(), z.unknown().describe('A keyword of the model document.'))
      .describe('`contract/model.schema.json`, verbatim: the data model as JSON Schema 2020-12.'),
  })
  .describe('The UI manifest: the contract of the application for tests and agents.')

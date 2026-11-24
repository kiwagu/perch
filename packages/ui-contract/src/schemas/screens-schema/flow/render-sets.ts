/**
 * The sets of anchors several states render, which only the authored flow writes: the map
 * `flow.meta.renders` and the names a state lists in its own `meta.renders`. The loader writes
 * each set into the states that list it (`expandFlow`), so the canonical flow lists anchors only.
 */

import { z } from '@workspace/zod'

import { anchorSchema, kebabNameSchema } from '../../../names.schema'

/** A name a state lists in `meta.renders` beside the anchors: a set of `flow.meta.renders`. */
export const renderSetNameSchema = kebabNameSchema.describe(
  'A set of `flow.meta.renders`, by name.',
)

/** The sets by name, each the anchors the states that list it render. */
export const renderSetsSchema = z
  .record(
    kebabNameSchema,
    z
      .array(anchorSchema)
      .min(1)
      .describe('The anchors of the set, which each state that lists it renders.'),
  )
  .describe(
    'Anchors that several states render, named once: a state that lists the name in its `meta.renders` renders those anchors. A set serves two states or more. See the rule `render-sets`.',
  )

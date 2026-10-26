/**
 * The names a flow uses: its states and the targets of its transitions, its events (an
 * anchor, a platform event, a data event), its guards, and the literals of a search.
 */

import { z } from '@workspace/zod'

export const flowStateNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .describe('A state of the flow, a key of its `states`: `sign-in`, `signing-in`.')

export const flowTargetSchema = z
  .string()
  .regex(
    /^(#[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*|[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)?)$/,
  )
  .describe(
    'A state of the flow, or of the region the transition is in (`signing-in`); from the root, a state of a region as `<parallel>.<region>.<state>` (`viewing.create-form.open`); from a state of a region, a state of the root as `#<flow id>.<state>` (`#organisation.viewing`).',
  )

export const platformEventNameSchema = z
  .string()
  .regex(/^platform\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  .describe('A platform event: `platform.<name>`, an event of platform.events.')

export const modelEventNameSchema = z
  .string()
  .regex(/^model\.[a-z_]+\.[a-z_]+$/)
  .describe(
    'A data event: `model.<entity>.<field>`, the stored value of a field the screen shows changed, here or on another device.',
  )

export const guardNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .describe('A guard: a camelCase name of the flow `meta.guards`.')

const literalSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .describe('A string, a number or a boolean.')

export const searchSchema = z
  .record(z.string(), literalSchema)
  .describe('Search parameters of the binding, each a literal (`$id` for a minted id).')

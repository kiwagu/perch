/**
 * The names a flow uses: its states and the targets of its transitions, its events (an
 * anchor, a platform event, a data event), its guards, and the values of a search: literals in
 * an address, and in a navigate also the value a field of the screen holds or the data-id of the
 * entry of an item whose control the user acted on.
 */

import { z } from '@workspace/zod'

import { anchorSchema } from '../../../names.schema'

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

export const navigateSearchSchema = z
  .record(
    z.string(),
    z.union([
      literalSchema,
      z
        .strictObject({
          anchor: anchorSchema.describe('A field of the screen, declared on it.'),
        })
        .describe(
          'The value the field holds when the app moves: `{ anchor: user.sign-in.email-input }`.',
        ),
      z
        .strictObject({
          item: anchorSchema.describe('An item or a row of the screen, with a `dataId`.'),
        })
        .describe(
          'The data-id of the entry whose control the user acted on: `{ item: device.list.session-item }`.',
        ),
    ]),
  )
  .describe(
    'Search parameters of the binding, each a literal (`$id` for a minted id), `{ anchor }`, the value a field of the screen holds, or `{ item }`, the data-id of the entry whose control the user acted on.',
  )

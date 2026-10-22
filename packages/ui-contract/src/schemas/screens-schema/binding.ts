/** A route of a screen in the router's format (TanStack): path, guard, roles, parameters. */

import { z } from '@workspace/zod'

import { roleSchema } from '../../names.schema'
import { flatJsonSchema } from '../flat-json-schema'

const SEGMENT =
  '([a-z0-9][a-z0-9-]*|\\$[a-zA-Z_][a-zA-Z0-9_]*|\\{-\\$[a-zA-Z_][a-zA-Z0-9_]*\\}|\\$)'

export const routePathSchema = z
  .string()
  .regex(new RegExp(`^/(${SEGMENT}(/${SEGMENT})*)?$`))
  .describe(
    'The route path: static segments, `$param`, `{-$param}` (optional) and `$` (splat), from `/`.',
  )

export const bindingSchema = z
  .strictObject({
    path: routePathSchema,
    guard: z
      .enum(['guest', 'authenticated'])
      .optional()
      .describe(
        'Who may open the route: only a guest, or only a signed-in account; absent: anyone.',
      ),
    roles: z.array(roleSchema).min(1).describe('The roles the route serves.'),
    params: flatJsonSchema.optional().describe('The path parameters, as a flat JSON Schema.'),
    search: flatJsonSchema.optional().describe('The search parameters, as a flat JSON Schema.'),
    history: z
      .enum(['push', 'replace'])
      .default('push')
      .describe('Whether opening the route adds a history entry or replaces the current one.'),
    retain: z
      .array(z.string())
      .optional()
      .describe('The search parameters carried across navigations.'),
  })
  .describe('One route of the screen.')

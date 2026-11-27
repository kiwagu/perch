/**
 * The project's language, `contract/domain/terms.yaml`: the bounded contexts the contract speaks
 * in, the platform's terms and the roles a device holds. Each term and each role has its meaning,
 * the synonyms the contract's texts never use for it, and the name storage gives it where storage
 * names it otherwise; no applied migration is renamed to match. Every object is strict.
 */

import { z } from '@workspace/zod'

import { kebabNameSchema, roleSchema } from '../names.schema'

import { DESCRIPTION_PURPOSES } from './description-purposes'

/** A synonym: one lowercase word, or words joined by one space or one dash. */
const synonymSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*([ -][a-z0-9]+)*$/)
  .describe('A word the texts never use for it: lowercase, `tenant`, `device session`.')

const storageSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/)
  .describe(
    "Where storage names it otherwise: a table, `identity`, or a table's field, `identity.role`.",
  )

const entryOf = (meaning: string) =>
  z.strictObject({
    meaning: z.string().min(1).describe(meaning),
    synonyms: z
      .array(synonymSchema)
      .min(1)
      .meta({ uniqueItems: true })
      .exactOptional()
      .describe("The words the contract's texts and the emitted constants never use for it."),
    storage: storageSchema.exactOptional(),
  })

export const termsFileSchema = z
  .strictObject({
    contexts: z
      .record(
        kebabNameSchema,
        z.strictObject({ meaning: z.string().min(1).describe(DESCRIPTION_PURPOSES.context) }),
      )
      .describe('The bounded contexts, by name: one while the product is one.'),
    terms: z
      .record(kebabNameSchema, entryOf(DESCRIPTION_PURPOSES.term))
      .describe("The platform's terms, by the one word the contract uses for each."),
    roles: z
      .record(roleSchema, entryOf(DESCRIPTION_PURPOSES.role))
      .describe(
        'The roles a device holds, by name: what `roles` of a binding, an anchor or an action list.',
      ),
  })
  .describe("The project's language: its contexts, its terms and its roles.")

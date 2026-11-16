/** When an element shows, by structure: the entries of an anchor's `with` and `without`. */

import { z } from '@workspace/zod'

import { baseAnchorSchema, codeSchema } from '../../names.schema'

/** One entry: an anchor, or one anchor with the codes it shows. */
export const withEntrySchema = z
  .union([
    baseAnchorSchema,
    z
      .record(baseAnchorSchema, z.array(codeSchema).min(1))
      .refine((one) => Object.keys(one).length === 1, {
        message: 'names one anchor with its codes',
      })
      .meta({ minProperties: 1, maxProperties: 1 })
      .describe('The anchor, with the codes it shows meanwhile.'),
  ])
  .describe(
    'An anchor of the screen, or `{ <anchor>: [codes] }`: that anchor while it shows one of these codes.',
  )

const UNDER_AN_ENTRY =
  'An anchor rendered in each entry of a list (in the part of its `item` or `row`, `<part>.<name>`, or declared under it) names anchors of the same entry, and means the same entry. See the rule `with-without`.'

/** The entries that each render while the element does. */
export const withSchema = z
  .array(withEntrySchema)
  .min(1)
  .describe(
    `The element renders only while each of these renders: an anchor of its screen (the frame's, on the frame), or \`{ <anchor>: [codes] }\`, that anchor while it shows one of these codes. ${UNDER_AN_ENTRY}`,
  )

/** The entries none of which renders while the element does. */
export const withoutSchema = z
  .array(withEntrySchema)
  .min(1)
  .describe(
    `The element renders only while none of these renders: an anchor of its screen (the frame's, on the frame), or \`{ <anchor>: [codes] }\`, that anchor while it shows one of these codes. ${UNDER_AN_ENTRY}`,
  )

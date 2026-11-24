/**
 * What a guard of a flow's `meta.guards` holds. A screen file writes a sentence, or the failure
 * codes it holds for; the flow every reader takes may also hold a guard the loader derives from
 * the screen's password pair (`files/derive/pairs.ts`), which no screen file writes.
 */

import { z } from '@workspace/zod'

import { codeSchema } from '../../../names.schema'
import { DESCRIPTION_PURPOSES } from '../../description-purposes'

/**
 * A guard by failure code: it holds when the action of the invoke whose `onError` it guards
 * failed with one of its codes, so a bare `show` on its branch shows exactly them.
 */
export const codeGuardSchema = z
  .strictObject({
    codes: z
      .array(codeSchema)
      .min(1)
      .describe('The codes it holds for: the action failed with one of them.'),
  })
  .describe(
    'A guard by failure code, on a branch of an `onError` only: it holds when the action failed with one of its codes.',
  )

/** What a guard of a password pair may hold of the confirmation against the input it confirms. */
const PAIR_RELATIONS = ['differs', 'strays', 'follows'] as const

const PAIR_RULE = 'See the rule `password-pair`.'

/** A guard of the password pair on the confirmation, derived by the loader. */
export const pairGuardSchema = z
  .strictObject({
    confirms: z
      .enum(PAIR_RELATIONS)
      .describe(
        'What it holds of the confirmation against the input the confirmation confirms: `differs`, `strays` or `follows`, each the meaning of the rule `pair-differs`, `pair-strays` or `pair-follows`.',
      ),
  })
  .describe(
    `Derived: a guard on the confirmation of the screen's password pair, the input that writes \`confirms\`; a screen file never writes it. ${PAIR_RULE}`,
  )

/** A guard of the password pair on the confirmed input's composite, derived by the loader. */
export const compositeGuardSchema = z
  .strictObject({
    composite: z
      .literal('breaks')
      .describe(
        'The input the confirmation confirms breaks a rule of its composite: the meaning of the rule `composite-breaks`.',
      ),
  })
  .describe(
    `Derived: a guard on the composite of the input the screen's password pair confirms; a screen file never writes it. ${PAIR_RULE}`,
  )

const sentenceGuardSchema = z.string().describe(DESCRIPTION_PURPOSES.guard)

/** What a guard holds as a screen file writes it. */
export const authoredGuardSchema = z
  .union([sentenceGuardSchema, codeGuardSchema])
  .describe('What a guard holds: a sentence, or the failure codes it holds for.')

/** What a guard holds as every reader takes it: a guard a password pair derives too. */
export const guardSchema = z
  .union([sentenceGuardSchema, codeGuardSchema, pairGuardSchema, compositeGuardSchema])
  .describe(
    "What a guard holds: a sentence, the failure codes it holds for, or a guard the loader derives from the screen's password pair.",
  )

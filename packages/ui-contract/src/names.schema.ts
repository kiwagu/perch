/**
 * The names the contract files share: anchors, screen names, roles, codes and states.
 * The vocabulary holds the closed lists; these schemas check only the spelling, and the
 * contract check matches the names against the vocabulary.
 */

import { z } from '@workspace/zod'

import { ANCHOR_PATTERN } from './anchors'

const WORD = '[a-z][a-z0-9]*(-[a-z0-9]+)*'

/** A kebab-case word group: `sign-in`, `storage-blocked`. */
export const kebabNameSchema = z.string().regex(new RegExp(`^${WORD}$`))

/** Any anchor a page renders, a base one or a derived one. */
export const anchorSchema = z
  .string()
  .regex(ANCHOR_PATTERN)
  .describe('An anchor (a data-testid): 2 to 5 dot-separated kebab-case segments.')

/** A declared anchor: 2 to 4 segments, the screen name first and the kind last. */
export const baseAnchorSchema = z
  .string()
  .regex(new RegExp(`^${WORD}(\\.${WORD}){1,3}$`))
  .describe('A declared anchor: 2 to 4 dot-separated kebab-case segments, kind last.')

export const screenNameSchema = z
  .string()
  .regex(new RegExp(`^${WORD}(\\.${WORD})?$`))
  .describe('A screen name of the vocabulary: one or two kebab-case segments.')

export const roleSchema = kebabNameSchema.describe('A role of the vocabulary.')

export const codeSchema = kebabNameSchema.describe('A code of the vocabulary (data-code).')

export const stateSchema = kebabNameSchema.describe('A state of the vocabulary (data-state).')

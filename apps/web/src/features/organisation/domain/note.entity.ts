/**
 * A note of an organisation: a short text every member reads, naming the member who wrote it.
 * It lives in the organisation's tenant region.
 */

import type { Result } from 'neverthrow'

import { applyRules, type DomainRule, type RuleViolation } from '@workspace/kernel'

/** The longest note, in characters; the organisation database's schema holds the same bound. */
export const NOTE_TEXT_MAX = 500

const textRules: readonly DomainRule<string>[] = [
  { code: 'note:TEXT_REQUIRED', isSatisfiedBy: (text) => text.length > 0 },
  { code: 'note:TEXT_TOO_LONG', isSatisfiedBy: (text) => text.length <= NOTE_TEXT_MAX },
]

/** A note's text as the organisation stores it: trimmed, present and not too long. */
export function checkNoteText(text: string): Result<string, readonly RuleViolation[]> {
  return applyRules(text.trim(), textRules)
}

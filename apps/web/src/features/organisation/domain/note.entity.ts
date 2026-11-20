/**
 * A note of an organisation: a short text every member reads, naming the member who wrote it.
 * It lives in the organisation's tenant region.
 */

import type { Result } from 'neverthrow'

import { applyRules, CONTRACT_VALUES, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { textLength } from '../../../platform/text-length'

const textRules: readonly DomainRule<string>[] = [
  { code: 'note:TEXT_REQUIRED', isSatisfiedBy: (text) => text.length > 0 },
  {
    code: 'note:TEXT_TOO_LONG',
    isSatisfiedBy: (text) => textLength(text) <= CONTRACT_VALUES['note.text'].maxLength,
  },
]

/** A note's text as the organisation stores it: trimmed, present and not too long. */
export function checkNoteText(text: string): Result<string, readonly RuleViolation[]> {
  return applyRules(text.trim(), textRules)
}

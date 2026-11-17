import type { ReferenceRule } from './rule'
import { referenceSlug } from './slug'

/**
 * What the reference writes of a rule under its anchor: its text, then a line with a link to
 * each key it concerns. One function for the reference and for a reader that carries the text
 * elsewhere (the manifest), so the two never differ.
 */
export function ruleTextOf({ text, keys }: Pick<ReferenceRule, 'text' | 'keys'>): string {
  const links = keys.map((key) => `[\`${key}\`](#${referenceSlug(key)})`)

  return links.length === 0 ? text : `${text}\n\nKeys it concerns: ${links.join(', ')}.`
}

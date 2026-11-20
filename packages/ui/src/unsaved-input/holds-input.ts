import { useFieldFacts } from '@workspace/ui/field-facts'

/**
 * Whether a field keeps what is typed until an action takes it: its own say, else its facts'
 * (by its anchor), else true.
 */
export const useHoldsInput = (own: boolean | undefined, anchor?: string | undefined): boolean => {
  const facts = useFieldFacts(anchor)

  return own ?? facts?.holdsInput ?? true
}

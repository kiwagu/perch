import { cn } from 'cn'
import type * as React from 'react'

import { useFieldFacts } from '@workspace/ui/field-facts'
import {
  stateBorder,
  useHoldsInput,
  useMarksState,
  useTracksInput,
} from '@workspace/ui/unsaved-input'

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** The field keeps what is typed until an action takes it (its facts' say, else the default); false for a field whose own change runs its action. */
  readonly holdsInput?: boolean | undefined
  /** The anchor the field renders, which it also reports while it holds unsaved input, and by which it finds its facts. */
  readonly 'data-testid'?: string | undefined
  /** Whether the field colors its border by its state (its facts' say, else its form's, else true); `data-state` stays either way. */
  readonly marksState?: boolean | undefined
}

/** A value as the textarea shows it. */
const text = (value: React.ComponentProps<'textarea'>['value']): string | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value.join(',') : String(value)

/** A textarea: what its element does not say, its facts (by its anchor) give: `maxLength`. */
function Textarea({
  className,
  maxLength,
  holdsInput,
  marksState,
  onChange,
  ...props
}: TextareaProps) {
  const anchor = props['data-testid']
  const facts = useFieldFacts(anchor)
  const holds = useHoldsInput(holdsInput, anchor)
  const { typed, state } = useTracksInput({
    holdsInput: holds,
    anchor,
    value: text(props.value),
    defaultValue: text(props.defaultValue) ?? '',
  })

  const marks = useMarksState(marksState, anchor)

  return (
    <textarea
      maxLength={maxLength ?? facts?.maxLength}
      data-slot="textarea"
      data-state={state}
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        stateBorder(marks),
        className,
      )}
      onChange={(event) => {
        typed(event.target.value)
        onChange?.(event)
      }}
      {...props}
    />
  )
}

export { Textarea }

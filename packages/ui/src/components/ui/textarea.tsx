import { cn } from 'cn'
import type * as React from 'react'

import { useTracksInput } from '@workspace/ui/unsaved-input'

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** The field keeps what is typed until an action takes it (the default); false for a field whose own change runs its action. */
  readonly holdsInput?: boolean | undefined
}

/** A value as the textarea shows it. */
const text = (value: React.ComponentProps<'textarea'>['value']): string | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value.join(',') : String(value)

function Textarea({ className, holdsInput = true, onChange, ...props }: TextareaProps) {
  const { typed } = useTracksInput({
    holdsInput,
    value: text(props.value),
    defaultValue: text(props.defaultValue),
  })

  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
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

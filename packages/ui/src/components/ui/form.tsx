import { type ComponentProps, type SubmitEvent, useMemo, useRef } from 'react'

import { type FormScope, FormScopeContext } from '@workspace/ui/unsaved-input'

export interface FormProps extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  /** Runs the form's action; `true` once it saved, and the form's fields then hold no unsaved input. */
  readonly onSubmit: () => Promise<boolean> | boolean
}

/** A form whose fields know when a submit saved them; the default submit is always prevented. */
function Form({ onSubmit, ...props }: FormProps) {
  const marks = useRef(new Set<() => void>())
  const scope = useMemo<FormScope>(
    () => ({
      enlist: (markClean) => {
        marks.current.add(markClean)

        return () => {
          marks.current.delete(markClean)
        }
      },
    }),
    [],
  )
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    void Promise.resolve(onSubmit()).then((saved) => {
      if (saved) {
        for (const markClean of marks.current) {
          markClean()
        }
      }
    })
  }

  return (
    <FormScopeContext.Provider value={scope}>
      <form data-slot="form" onSubmit={submit} {...props} />
    </FormScopeContext.Provider>
  )
}

export { Form }

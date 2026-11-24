import { type ComponentProps, type SubmitEvent, useMemo, useRef } from 'react'

import { type Capture, type FormScope, FormScopeContext } from '@workspace/ui/unsaved-input'

export interface FormProps extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  /** Runs the form's action; `true` once it saved what its fields held when it started. */
  readonly onSubmit: () => Promise<boolean> | boolean
  /** Whether its fields mark their state (true when left out); a field's own say wins. */
  readonly marksState?: boolean | undefined
}

/**
 * A form whose fields know when a submit saved them: each field holds no unsaved input once the
 * value it held when the submit started is saved. The default submit is always prevented.
 */
function Form({ onSubmit, marksState = true, ...props }: FormProps) {
  const fields = useRef(new Set<Capture>())
  const scope = useMemo<FormScope>(
    () => ({
      enlist: (capture) => {
        fields.current.add(capture)

        return () => {
          fields.current.delete(capture)
        }
      },
      marksState,
    }),
    [marksState],
  )
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()

    const marks = [...fields.current].map((capture) => capture())

    void Promise.resolve(onSubmit()).then((saved) => {
      if (saved) {
        for (const markSaved of marks) {
          markSaved()
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

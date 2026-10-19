import { useState } from 'react'

/** Runs a form's action, one at a time: `pending` while it runs, then `after` hears whether it was done. */
export function useAction(): readonly [
  boolean,
  (action: Promise<boolean>, after: (done: boolean) => void) => void,
] {
  const [pending, setPending] = useState(false)

  return [
    pending,
    (action, after) => {
      setPending(true)
      void action.then((done) => {
        setPending(false)
        after(done)
      })
    },
  ]
}

import { useState } from 'react'

/**
 * What a form's fields hold as typed in the organisation the page shows: another organisation
 * starts them afresh, and coming back to one does not bring back what was typed before, as when
 * the form was a view of its own that the page showed anew for each organisation. `change` takes
 * what the fields hold and returns what they hold next.
 */
export function useOrganisationDraft<Draft>(organisation: string | undefined, empty: Draft) {
  const [kept, setKept] = useState<{ readonly of: string | undefined; readonly draft: Draft }>({
    of: organisation,
    draft: empty,
  })

  if (kept.of !== organisation) {
    setKept({ of: organisation, draft: empty })
  }

  return {
    draft: kept.of === organisation ? kept.draft : empty,
    change: (change: (draft: Draft) => Draft) =>
      setKept((now) => ({
        of: organisation,
        draft: change(now.of === organisation ? now.draft : empty),
      })),
  }
}

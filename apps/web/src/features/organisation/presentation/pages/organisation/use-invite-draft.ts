import { useState } from 'react'

import type { InviteDraft } from '../../components/organisation-invite/organisation-invite.view'

const EMPTY: InviteDraft = { email: '', role: 'member' }

/** The invitation form's fields as typed in one organisation: another organisation starts them afresh. */
export function useInviteDraft(key: string | undefined) {
  const [kept, setKept] = useState<{
    readonly of: string | undefined
    readonly draft: InviteDraft
  }>({ of: key, draft: EMPTY })
  const changed = (change: (draft: InviteDraft) => InviteDraft) =>
    setKept((now) => ({ of: key, draft: change(now.of === key ? now.draft : EMPTY) }))

  return {
    draft: kept.of === key ? kept.draft : EMPTY,
    set: (draft: InviteDraft) => changed(() => draft),
    /** Empties the email, or puts the role back to member: as the flow clears the form's fields. */
    clearEmail: () => changed((draft) => ({ ...draft, email: '' })),
    clearRole: () => changed((draft) => ({ ...draft, role: EMPTY.role })),
  }
}

import { useEffect, useState } from 'react'

import type { MemberView } from '../../../../../platform/organisations.port'
import type { OrganisationService } from '../../../application/organisation.service'

/** The members of one organisation as last read, and the code the latest read failed with. */
interface MembersRead {
  readonly key: string
  readonly list: readonly MemberView[] | undefined
  readonly failure: string | undefined
}

/**
 * The members of organisation `key`, for an administrator (none to read without one): read when
 * it becomes current and again whenever `changed` counts another change made here. A read that
 * fails keeps the list read before it.
 */
export function useMembers(
  organisations: Pick<OrganisationService, 'members'>,
  key: string | undefined,
  changed: number,
): { readonly list: readonly MemberView[] | undefined; readonly failure: string | undefined } {
  const [read, setRead] = useState<MembersRead | undefined>(undefined)

  useEffect(() => {
    if (key === undefined) {
      return undefined
    }

    let live = true

    void organisations.members(key).match(
      (list) => {
        if (live) {
          setRead({ key, list, failure: undefined })
        }
      },
      (failure) => {
        if (live) {
          setRead((now) => ({
            key,
            list: now?.key === key ? now.list : undefined,
            failure: failure.code,
          }))
        }
      },
    )

    return () => {
      live = false
    }
  }, [organisations, key, changed])

  return read !== undefined && read.key === key ? read : { list: undefined, failure: undefined }
}

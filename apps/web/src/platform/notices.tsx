/**
 * Short messages for the user that outlive the page that raised them, such as
 * "Welcome" after signing up, which the next page still shows. The shell
 * renders the latest one.
 */

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

export interface Notice {
  /** The contract code of what it says (`welcome`, `profile-saved`), shown as `data-code`. */
  readonly code: string
  /** Already translated: the page that raises a notice knows its words. */
  readonly text: string
}

interface NoticeChannel {
  readonly notice: Notice | undefined
  readonly notify: (notice: Notice) => void
}

const NoticeContext = createContext<NoticeChannel>({ notice: undefined, notify: () => {} })

export function NoticeProvider(props: { readonly children: ReactNode }) {
  const [notice, notify] = useState<Notice | undefined>(undefined)
  const channel = useMemo(() => ({ notice, notify }), [notice])

  return <NoticeContext.Provider value={channel}>{props.children}</NoticeContext.Provider>
}

export const useNotify = (): ((notice: Notice) => void) => useContext(NoticeContext).notify

export const useNotice = (): Notice | undefined => useContext(NoticeContext).notice

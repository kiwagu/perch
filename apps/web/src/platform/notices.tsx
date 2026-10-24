/**
 * Short messages for the user that outlive the page that raised them, such as
 * "Welcome" after signing up, which the next page still shows. The shell
 * renders the latest one, until a newer one replaces it or the shell clears it.
 */

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import type { Translate } from '@workspace/i18n'

export interface Notice {
  /** The contract code of what it says (`welcome`, `profile-saved`), shown as `data-code`. */
  readonly code: string
  /**
   * Its words, which the page that raises it knows, said in the language the app speaks while it
   * is shown: a notice raised in one language reads in the next one chosen.
   */
  readonly text: (t: Translate) => string
}

interface NoticeChannel {
  readonly notice: Notice | undefined
  readonly notify: (notice: Notice) => void
  readonly clear: () => void
}

const NoticeContext = createContext<NoticeChannel>({
  notice: undefined,
  notify: () => {},
  clear: () => {},
})

export function NoticeProvider(props: { readonly children: ReactNode }) {
  const [notice, notify] = useState<Notice | undefined>(undefined)
  const clear = useCallback(() => notify(undefined), [])
  const channel = useMemo(() => ({ notice, notify, clear }), [notice, clear])

  return <NoticeContext.Provider value={channel}>{props.children}</NoticeContext.Provider>
}

export const useNotify = (): ((notice: Notice) => void) => useContext(NoticeContext).notify

export const useNotice = (): Notice | undefined => useContext(NoticeContext).notice

/** Takes the notice away: the shell does when the account it was raised for signs out. */
export const useClearNotice = (): (() => void) => useContext(NoticeContext).clear

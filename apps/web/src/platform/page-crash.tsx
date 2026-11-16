import { type ErrorComponentProps, useMatch, useRouter } from '@tanstack/react-router'
import { type FunctionComponent, useCallback } from 'react'

/** What the router puts in the place of a page that failed, given the way to render it again. */
export type PageCrash = FunctionComponent<ErrorComponentProps>

/**
 * `Crash`, whose `reset` renders the failed page again whatever failed. A page that failed to
 * render is rendered again as it is. A route whose load failed (a lazy page whose code did not
 * arrive) keeps its failure until it loads again, so a render alone would fail the same way: the
 * open routes are loaded again instead (`router.invalidate`), the code of the page with them.
 */
export function pageCrash(Crash: PageCrash): PageCrash {
  return function RenderAgain(props: ErrorComponentProps) {
    const router = useRouter()
    const loadFailed = useMatch({ strict: false, select: (match) => match.status === 'error' })
    const { reset } = props
    const again = useCallback(() => {
      if (loadFailed) {
        void router.invalidate()
      } else {
        reset()
      }
    }, [loadFailed, reset, router])

    return <Crash {...props} reset={again} />
  }
}

/**
 * The screen the router resolved for the address open, as the frame names and marks it: the path
 * of its route as declared (`/$` for an address no other route takes), and `/$` as well for a page
 * whose roles the device does not hold, which the router answers with the not-found page at the
 * page's own address. So the browser tab's title and the navigation never name a screen the
 * device was refused.
 */

/** The path of the binding that opens the not-found screen. */
export const NOT_FOUND_PATH = '/$'

/** The fields of the router's state this reads: the router types its matches loosely. */
interface RoutedState {
  readonly matches: readonly { readonly fullPath: unknown; readonly status: string }[]
}

/** The declared path of the screen resolved, `/$` for a refused page; none before any match. */
export function resolvedRoute(state: RoutedState): string | undefined {
  const last = state.matches.at(-1)

  if (last?.status === 'notFound') {
    return NOT_FOUND_PATH
  }

  return typeof last?.fullPath === 'string' ? last.fullPath : undefined
}

import { type FunctionComponent, use } from 'react'

import type { LazyPage } from './module'

/** A route's component whose code the router loads, by its `preload`, before it renders it. */
export type LoadedOnDemand = FunctionComponent & { readonly preload: () => Promise<void> }

/**
 * The component of a lazy page. The router runs its `preload` as it loads the page's route,
 * which comes after the route's guard and roles, and renders it once the code is in: a device the
 * route refuses never loads it. The code loads once; a load that failed fails the route's load
 * (the frame's crash in the page's place), and the route's next load loads it again: its next
 * opening, or the crash's render again (`pageCrash`).
 */
export function lazyComponent(page: LazyPage): LoadedOnDemand {
  let Page: FunctionComponent | undefined
  let loading: Promise<FunctionComponent> | undefined
  const load = (): Promise<FunctionComponent> => {
    loading ??= page.load().then(
      (component) => {
        Page = component

        return component
      },
      (error: unknown) => {
        loading = undefined

        throw error
      },
    )

    return loading
  }

  function OnDemand() {
    // The router renders it once `preload` is done; a render before that waits for the code.
    const Loaded = Page ?? use(load())

    return <Loaded />
  }

  return Object.assign(OnDemand, {
    preload: async () => {
      await load()
    },
  })
}

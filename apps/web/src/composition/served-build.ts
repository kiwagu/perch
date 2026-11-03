/**
 * The build the server serves, read from its UI manifest, against the build this tab runs. The
 * front never lets the manifest be cached, and the tab reads it when the watch starts, each time
 * the tab comes back to the foreground and every ten minutes while it is there. A manifest the
 * server does not serve (the front can switch it off), one that does not read, and a failed read
 * say nothing: the next read asks again.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { ServedBuildPort } from '../platform/served-build.port'

import type { Fetcher } from './gateway-auth'
import type { VisibilitySource } from './session'

const MANIFEST = '/ui-manifest/manifest.json'
const EVERY = 10 * 60 * 1000

/** A build of the app: the root package's version and the commit, as the manifest names its product. */
export interface Build {
  readonly version: string
  readonly commit: string | null
}

// Only the product of the manifest is read here.
const servedSchema = z.object({
  product: z.object({ version: z.string().min(1), commit: z.string().nullable() }),
})

export interface ServedBuildOptions {
  /** The build this tab runs. */
  readonly running: Build
  readonly fetcher: Fetcher
  readonly visibility: VisibilitySource
  readonly clock: Clock
}

const named = (build: Build): string => `${build.version}+${build.commit ?? 'no-commit'}`

const unread = () => 'unread' as const

const read = (fetcher: Fetcher): ResultAsync<Build, 'unread'> =>
  ResultAsync.fromPromise(fetcher(MANIFEST, { cache: 'no-store' }), unread)
    .andThen((response) =>
      response.ok ? ResultAsync.fromPromise(response.json(), unread) : errAsync(unread()),
    )
    .andThen((body: unknown) => {
      const served = servedSchema.safeParse(body)

      return served.success ? okAsync(served.data.product) : errAsync(unread())
    })

export function servedBuild(options: ServedBuildOptions): ServedBuildPort {
  const running = named(options.running)

  return {
    watch(onNewer) {
      let stopped = false
      let cancel = () => {}
      // Off once a newer build is heard: the frame says it until the page loads again.
      const stop = () => {
        stopped = true
        cancel()
        unlisten()
      }
      const check = () => {
        if (stopped || options.visibility.current() !== 'visible') {
          return
        }

        void read(options.fetcher).match(
          (build) => {
            const served = named(build)

            if (!stopped && served !== running) {
              stop()
              onNewer(served)
            }
          },
          // Unread: the next read asks again.
          () => undefined,
        )
      }
      const every = () => {
        cancel = options.clock.schedule(EVERY, () => {
          check()
          every()
        })
      }
      const unlisten = options.visibility.onChange((state) => {
        if (state === 'visible') {
          check()
        }
      })

      check()
      every()

      return stop
    },
  }
}

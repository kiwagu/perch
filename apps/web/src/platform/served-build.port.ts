import { token } from '@workspace/di'

/** Hears that the server serves a newer build of the app than the one this tab runs. */
export interface ServedBuildPort {
  /**
   * Calls `onNewer` once the server serves another build, named by its version and its commit,
   * which tells one update from the next; nothing while the server serves no manifest. Until the
   * returned stop.
   */
  watch(onNewer: (served: string) => void): () => void
}

export const SERVED_BUILD = token<ServedBuildPort>('ServedBuild')

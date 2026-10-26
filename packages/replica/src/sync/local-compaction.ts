import type { DataError } from '@workspace/data'

import type { RegionDoc } from '../region-doc'

/**
 * Compacts a region's local log once it holds more than `limit` rows past the region's snapshot.
 * A failure is reported once, until a compaction succeeds again.
 */
export class LocalCompaction {
  /** The last compaction failed; reported once until one succeeds. */
  #failing = false

  constructor(
    private readonly region: RegionDoc,
    private readonly limit: number,
    private readonly onError: (error: DataError) => void,
  ) {}

  async run(): Promise<void> {
    const compacted = await this.region.compactIfLong(this.limit)

    if (compacted.isOk()) {
      this.#failing = false

      return
    }

    if (!this.#failing) {
      this.#failing = true
      this.onError(compacted.error)
    }
  }
}

import type { DataError } from '@workspace/data'

import { COMPACTION_LOG_LIMIT } from '../compaction-limit'
import type { RegionDoc } from '../region-doc'

/**
 * Compacts a region's local log once it holds more than `limit` rows past the region's snapshot
 * (an integer from 0, 200 by default). A failure is reported once, until a compaction succeeds again.
 */
export class LocalCompaction {
  private readonly limit: number
  /** The last compaction failed; reported once until one succeeds. */
  #failing = false

  constructor(
    private readonly region: RegionDoc,
    limit: number | undefined,
    private readonly onError: (error: DataError) => void,
  ) {
    this.limit = limit ?? COMPACTION_LOG_LIMIT

    if (!Number.isInteger(this.limit) || this.limit < 0) {
      throw new RangeError('localCompactionRows must be an integer from 0')
    }
  }

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

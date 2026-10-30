import type { DataError } from '@workspace/data'

import type { RegionDoc } from '../region-doc'

/**
 * Imports into a region's document the rows other tabs appended to the local log. A failure is
 * reported once, until an import succeeds again.
 */
export class LocalCatchUp {
  /** The last import failed; reported once until one succeeds. */
  #behind = false

  constructor(
    private readonly region: RegionDoc,
    private readonly onError: (error: DataError) => void,
  ) {}

  /** Resolves false when the import failed. */
  async run(): Promise<boolean> {
    const caught = await this.region.catchUpLocal()

    if (caught.isOk()) {
      this.#behind = false

      return true
    }

    if (!this.#behind) {
      this.#behind = true
      this.onError(caught.error)
    }

    return false
  }
}

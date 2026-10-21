import { okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { Logger } from '@workspace/logger'
import type { RegionHub } from '@workspace/replica/server'

import type { DeviceRegion } from './device-regions'

interface Head {
  readonly region: string
  readonly head: number
}

/**
 * The heads a welcome names, each region read on its own (each is kept in a database of its
 * own): an organisation whose database cannot be read leaves only its region out, logged, and the
 * device syncs the rest, the membership still listed, until its next hello reads it again. The
 * identity's own region failing fails the hello, as any failure of the directory does.
 */
export function welcomeHeads(
  hub: Pick<RegionHub, 'heads'>,
  regions: ReadonlyMap<string, DeviceRegion>,
  log: Logger,
): ResultAsync<readonly Head[], DataError> {
  const reads = [...regions].map(([region, { ref }]) => {
    const read = hub.heads([region]).map(([head]) => head)

    return ref.kind === 'private'
      ? read
      : read.orElse((error) => {
          log.error({ region, code: error.code }, 'a region was left out of the welcome')

          return okAsync(undefined)
        })
  })

  return ResultAsync.combine(reads).map((heads) =>
    heads.filter((head): head is Head => head !== undefined),
  )
}

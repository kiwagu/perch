import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { privateRegionId } from '@workspace/replica'
import type { RegionHub } from '@workspace/replica/server'
import { z } from '@workspace/zod'

import { reading } from '../auth/device-session-rows'

import profileOfStatement from './surql/profile-of.surql'

/** What a rename did: wrote the name, or found no profile to write it on. */
export type Renaming = 'renamed' | 'no-profile'

/** The profile of an identity as the directory answers it: its key, or none. */
const profileOf = z.array(idSchemas.profile.schema).max(1)

export interface ProfileNamesOptions {
  /** The directory, where the region hub projects the profile of each identity. */
  readonly directory: LocalDb
  /** The region hub, which writes the name into the identity's private region. */
  readonly hub: Pick<RegionHub, 'writeRecord'>
}

/**
 * The name an operator gives an account: its profile's, the name people see. It is written as a
 * change of the server's own to the profile in the identity's private region, through the region
 * hub (`writeRecord`): logged, projected into the directory and sent to every subscribed device of
 * the account like a batch of its own, so its devices show it as any change of the profile; one
 * that was offline gets it at its next pull. The profile is found by its identity in the
 * directory, where the hub projects the region's rows, so a profile under any id is found. An
 * account has no profile until a device's start reached the server (it never signed in), and then
 * nothing is written. The caller holds the account's turn.
 */
export class ProfileNames {
  readonly #options: ProfileNamesOptions

  constructor(options: ProfileNamesOptions) {
    this.#options = options
  }

  /**
   * Sets the name of `identity`'s profile to `name`, already held to the profile page's rule:
   * `renamed` once the hub took the write, `no-profile` with nothing written for an account that
   * has none. A write the hub refuses or fails is the hub's error.
   */
  rename(identity: IdentityId, name: string): ResultAsync<Renaming, DataError> {
    return this.#profileOf(identity).andThen((profile) =>
      profile === undefined
        ? okAsync<Renaming, DataError>('no-profile')
        : this.#options.hub
            .writeRecord(
              { kind: 'private', id: privateRegionId(identity) },
              { table: 'profile', id: profile, set: { name } },
            )
            .map((): Renaming => 'renamed'),
    )
  }

  /** The key of `identity`'s profile as the directory holds it, or none. */
  #profileOf(identity: IdentityId): ResultAsync<string | undefined, DataError> {
    return reading(
      this.#options.directory.db.query<[unknown]>(profileOfStatement, { identity }),
      `the profile of ${identity} could not be read`,
    ).andThen(([value]) => {
      const keys = profileOf.safeParse(value)

      return keys.success
        ? okAsync(keys.data[0])
        : errAsync(dataError('data:QUERY_FAILED', 'the profile of an account has an unknown shape'))
    })
  }
}
